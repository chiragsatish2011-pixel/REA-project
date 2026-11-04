import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  RedactionEngine,
  CredentialIsolationGuard,
  VaultCipher,
  NominKeyStore,
  StoredCredential,
} from '../src/config/keychain.js';
import { NominAuthManager } from '../src/config/auth-manager.js';
import { ConfigManager } from '../src/config/index.js';

describe('Nomin Code: Provider Key System, Keychain & Redaction Engine', () => {
  let tmpVaultDir: string;

  beforeEach(() => {
    tmpVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-vault-test-'));
    RedactionEngine.clearSecrets();
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tmpVaultDir)) {
        fs.rmSync(tmpVaultDir, { recursive: true, force: true });
      }
    } catch {}
    RedactionEngine.clearSecrets();
  });

  describe('RedactionEngine Security', () => {
    it('redacts standard NVIDIA NIM API keys', () => {
      const raw = 'Calling NIM with key nvapi-abc123456789012345678901234567890_xyz';
      const sanitized = RedactionEngine.redact(raw);
      assert.strictEqual(sanitized, 'Calling NIM with key [REDACTED_NVIDIA_API_KEY]');
      assert.strictEqual(sanitized.includes('nvapi-'), false);
    });

    it('redacts OpenAI, Anthropic, and Gemini keys', () => {
      const text = 'Keys: sk-123456789012345678901234, sk-ant-api03-123456789012345678901234567890, and AIzaSyD12345678901234567890123456789012';
      const sanitized = RedactionEngine.redact(text);
      assert.strictEqual(sanitized.includes('sk-1234'), false);
      assert.strictEqual(sanitized.includes('sk-ant-'), false);
      assert.strictEqual(sanitized.includes('AIzaSy'), false);
    });

    it('redacts dynamically registered custom secrets', () => {
      const secret = 'custom_super_secret_enterprise_token_999';
      RedactionEngine.registerSecret(secret);

      const log = `Error executing tool: token was ${secret} during request`;
      const cleaned = RedactionEngine.redact(log);
      assert.strictEqual(cleaned.includes(secret), false);
      assert.strictEqual(cleaned, 'Error executing tool: token was [REDACTED_SECRET] during request');
    });

    it('redacts deep nested objects and JSON payloads', () => {
      const payload = {
        endpoint: 'https://integrate.api.nvidia.com/v1',
        apiKey: 'nvapi-abcdef12345678901234567890123456',
        nested: {
          secret_key: 'my-ultra-secret',
          count: 42,
        },
      };

      const sanitized = RedactionEngine.redactDeep(payload) as any;
      assert.strictEqual(sanitized.apiKey, '[REDACTED]');
      assert.strictEqual(sanitized.nested.secret_key, '[REDACTED]');
      assert.strictEqual(sanitized.nested.count, 42);
    });

    it('masks keys cleanly for user display', () => {
      const key = 'nvapi-99887766554433221100aabbccddeeff';
      const masked = RedactionEngine.maskKey(key);
      assert.strictEqual(masked, 'nvapi-...eeff');
    });
  });

  describe('CredentialIsolationGuard & Anti-Exfiltration', () => {
    it('detects and blocks access to sensitive vault files', () => {
      assert.strictEqual(CredentialIsolationGuard.isProtectedPath('C:/Users/user/.nomin/vault.enc'), true);
      assert.strictEqual(CredentialIsolationGuard.isProtectedPath('/home/user/.nomin/.env'), true);
      assert.strictEqual(CredentialIsolationGuard.isProtectedPath('/project/src/index.ts'), false);

      assert.throws(
        () => CredentialIsolationGuard.validateToolAccess('/home/user/.nomin/vault.enc', 'read_file'),
        /SecurityViolation/
      );
    });

    it('detects and blocks command exfiltration attempts in bash tool', () => {
      assert.throws(
        () => CredentialIsolationGuard.sanitizeCommand('cat ~/.nomin/vault.enc'),
        /SecurityViolation/
      );
      assert.throws(
        () => CredentialIsolationGuard.sanitizeCommand('printenv NVIDIA_API_KEY'),
        /SecurityViolation/
      );
      assert.doesNotThrow(
        () => CredentialIsolationGuard.sanitizeCommand('npm test')
      );
    });
  });

  describe('VaultCipher AES-256-GCM Encryption', () => {
    it('encrypts and decrypts credentials losslessly', () => {
      const plaintext = JSON.stringify({ key: 'nvapi-1234567890', provider: 'nim' });
      const encrypted = VaultCipher.encrypt(plaintext);

      assert.notStrictEqual(encrypted, plaintext);
      assert.strictEqual(encrypted.length > 50, true);

      const decrypted = VaultCipher.decrypt(encrypted);
      assert.strictEqual(decrypted, plaintext);
    });

    it('rejects tampered or corrupted ciphertext', () => {
      const plaintext = 'top_secret';
      const encrypted = VaultCipher.encrypt(plaintext);

      // Corrupt middle bytes
      const buf = Buffer.from(encrypted, 'base64');
      buf[buf.length - 5] ^= 0xff;
      const corruptedBase64 = buf.toString('base64');

      assert.throws(() => VaultCipher.decrypt(corruptedBase64));
    });
  });

  describe('NominKeyStore Multi-Key & Limits Engine', () => {
    it('stores, retrieves, and persists multiple keys per provider', () => {
      const store = new NominKeyStore(tmpVaultDir);

      const cred1: StoredCredential = {
        id: 'cred_1',
        providerId: 'nim',
        label: 'nim-personal',
        apiKey: 'nvapi-personal-1234567890',
        limits: { rpm: 30, tpm: 60000, concurrency: 4 },
        createdAt: Date.now(),
        isActive: true,
      };

      const cred2: StoredCredential = {
        id: 'cred_2',
        providerId: 'nim',
        label: 'nim-enterprise',
        apiKey: 'nvapi-enterprise-9999999999',
        limits: { rpm: 120, tpm: 300000, concurrency: 16 },
        createdAt: Date.now(),
        isActive: false,
      };

      store.addCredential(cred1);
      store.addCredential(cred2);

      assert.strictEqual(store.listCredentials('nim').length, 2);
      assert.strictEqual(store.getActiveCredential('nim')?.id, 'cred_1');

      // Reload fresh from disk to verify encryption persistence
      const freshStore = new NominKeyStore(tmpVaultDir);
      assert.strictEqual(freshStore.listCredentials('nim').length, 2);
      assert.strictEqual(freshStore.getCredential('cred_2')?.label, 'nim-enterprise');
    });

    it('rotates active keys cleanly', () => {
      const store = new NominKeyStore(tmpVaultDir);
      store.addCredential({
        id: 'k1',
        providerId: 'nim',
        label: 'key1',
        apiKey: 'nvapi-key-1',
        limits: { rpm: 30, tpm: 60000, concurrency: 4 },
        createdAt: 100,
        isActive: true,
      });
      store.addCredential({
        id: 'k2',
        providerId: 'nim',
        label: 'key2',
        apiKey: 'nvapi-key-2',
        limits: { rpm: 60, tpm: 120000, concurrency: 8 },
        createdAt: 200,
        isActive: false,
      });

      assert.strictEqual(store.getActiveCredential('nim')?.id, 'k1');

      const rotated = store.rotateKey('nim');
      assert.strictEqual(rotated?.id, 'k2');
      assert.strictEqual(store.getActiveCredential('nim')?.id, 'k2');
    });

    it('updates user-editable limits and records learned limits from headers', () => {
      const store = new NominKeyStore(tmpVaultDir);
      store.addCredential({
        id: 'k1',
        providerId: 'nim',
        label: 'key1',
        apiKey: 'nvapi-key-1',
        limits: { rpm: 30, tpm: 60000, concurrency: 4 },
        createdAt: 100,
        isActive: true,
      });

      // User updates limits
      store.updateLimits('k1', { rpm: 50, concurrency: 6 });
      assert.strictEqual(store.getCredential('k1')?.limits.rpm, 50);
      assert.strictEqual(store.getCredential('k1')?.limits.concurrency, 6);

      // System records auto-learned response headers
      store.recordLearnedLimits('nim', {
        'x-ratelimit-limit-requests': '45',
        'x-ratelimit-limit-tokens': '80000',
        'retry-after': '12',
      });

      const cred = store.getActiveCredential('nim');
      assert.strictEqual(cred?.learnedLimits?.detectedRpm, 45);
      assert.strictEqual(cred?.learnedLimits?.detectedTpm, 80000);
      assert.strictEqual(cred?.learnedLimits?.lastResetMs, 12000);
    });
  });

  describe('NominAuthManager Hot-Reload & Integration', () => {
    it('initializes and lists masked keys', () => {
      const store = new NominKeyStore(tmpVaultDir);
      store.addCredential({
        id: 'cred_test_1',
        providerId: 'nim',
        label: 'test-nim',
        apiKey: 'nvapi-abcdef12345678901234567890123456',
        limits: { rpm: 30, tpm: 60000, concurrency: 4 },
        createdAt: Date.now(),
        isActive: true,
      });

      const authMgr = new NominAuthManager(store);
      const list = authMgr.listKeys();
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].label, 'test-nim');
      assert.strictEqual(list[0].maskedKey, 'nvapi-...3456');
      assert.strictEqual(list[0].maskedKey.includes('abcdef'), false);
    });

    it('removes keys from vault', () => {
      const store = new NominKeyStore(tmpVaultDir);
      store.addCredential({
        id: 'cred_remove',
        providerId: 'openai',
        label: 'openai-temp',
        apiKey: 'sk-123456789012345678901234',
        limits: { rpm: 60, tpm: 150000, concurrency: 8 },
        createdAt: Date.now(),
        isActive: true,
      });

      const authMgr = new NominAuthManager(store);
      assert.strictEqual(authMgr.listKeys('openai').length, 1);

      const removed = authMgr.removeKey('openai-temp');
      assert.strictEqual(removed, true);
      assert.strictEqual(authMgr.listKeys('openai').length, 0);
    });
  });
});
