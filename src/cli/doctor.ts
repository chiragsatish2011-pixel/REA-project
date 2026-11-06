/**
 * Nomin Code: System Health & Diagnostic Suite (nomin doctor)
 * Audits credential vault, provider network reachability, live catalog discovery,
 * active model verification (TTFT/tools/reasoning), and workspace safety.
 * Supports plain human-readable terminal report and --json output.
 */

import { ConfigManager } from '../config/index.js';
import { NominHttpClient } from '../provider/client.js';
import { LiveCatalogManager } from '../provider/live-catalog.js';
import { ModelValidator } from '../provider/model-validator.js';
import { ANSI } from './ui.js';

export interface DoctorCheckResult {
  id: string;
  name: string;
  pass: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  timestamp: string;
  pass: boolean;
  activeProvider: string;
  activeModel?: string;
  checks: DoctorCheckResult[];
}

export class NominDoctor {
  public static async runDiagnostics(workdir?: string): Promise<DoctorReport> {
    const cfgManager = ConfigManager.getInstance(workdir);
    const cfg = cfgManager.getConfig();
    const activeProv = cfg.providers[cfg.activeProvider] || {
      id: cfg.activeProvider,
      name: cfg.activeProvider.toUpperCase(),
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    };

    const checks: DoctorCheckResult[] = [];
    let overallPass = true;

    // Check 1: Credential Check
    const keyInfo = cfgManager.getProviderKeyInfo(cfg.activeProvider);
    const apiKey = keyInfo.apiKey;
    if (apiKey) {
      checks.push({
        id: 'credentials',
        name: 'Provider Credentials',
        pass: true,
        message: `API key present for ${activeProv.name} [${keyInfo.masked}] (source: ${keyInfo.source})`,
      });
    } else {
      overallPass = false;
      checks.push({
        id: 'credentials',
        name: 'Provider Credentials',
        pass: false,
        message: `Missing API key for ${activeProv.name}. Run '/key <key>' or 'nomin auth add ${activeProv.id}'`,
      });
    }

    // Check 2: Endpoint Base URL
    const baseUrl = activeProv.baseUrl;
    let urlValid = false;
    try {
      const u = new URL(baseUrl);
      urlValid = u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      urlValid = false;
    }

    if (urlValid) {
      checks.push({
        id: 'base_url',
        name: 'Provider Base URL',
        pass: true,
        message: `Base URL configured: ${baseUrl}`,
      });
    } else {
      overallPass = false;
      checks.push({
        id: 'base_url',
        name: 'Provider Base URL',
        pass: false,
        message: `Invalid base URL: '${baseUrl}'`,
      });
    }

    // Setup client for live checks
    const provType = (cfg.activeProvider === 'nim' ? 'nvidia-nim' : 'openai') as any;
    const client = new NominHttpClient({
      config: {
        id: cfg.activeProvider,
        name: activeProv.name,
        type: provType,
        baseURL: baseUrl,
        apiKey,
      },
    });

    // Check 3: Live Model Catalog Discovery
    try {
      const models = await LiveCatalogManager.fetchLiveModels(client, { forceRefresh: false });
      checks.push({
        id: 'catalog_fetch',
        name: 'Live Model Catalog',
        pass: true,
        message: `Discovered ${models.length} live models from ${activeProv.name}`,
        details: { count: models.length },
      });
    } catch (catErr: any) {
      overallPass = false;
      checks.push({
        id: 'catalog_fetch',
        name: 'Live Model Catalog',
        pass: false,
        message: `Failed to fetch live model catalog: ${catErr.message}`,
      });
    }

    // Check 4: Selected Model Verification
    const activeModel = cfg.activeModel;
    if (!activeModel) {
      checks.push({
        id: 'model_verification',
        name: 'Active Model Verification',
        pass: false,
        message: 'No model selected. Run /models or nomin model add <id>',
      });
    } else {
      const verifyRes = await ModelValidator.validateModel(client, activeModel, { timeoutMs: 10000 });
      if (verifyRes.ok) {
        checks.push({
          id: 'model_verification',
          name: 'Active Model Verification',
          pass: true,
          message: `Model '${activeModel}' is active (TTFT: ${verifyRes.ttftMs}ms, tools: ${verifyRes.supportsTools ? 'yes' : 'no'}, reasoning: ${verifyRes.supportsReasoning ? 'yes' : 'no'})`,
          details: {
            modelId: activeModel,
            ttftMs: verifyRes.ttftMs,
            supportsTools: verifyRes.supportsTools,
            supportsReasoning: verifyRes.supportsReasoning,
          },
        });
      } else {
        overallPass = false;
        const errMsg = verifyRes.error?.providerDetail || 'Verification ping failed';
        let detailMsg = errMsg;
        if (errMsg.includes('403') || errMsg.toLowerCase().includes('authorization failed')) {
          detailMsg = `${errMsg} — Your key listed models (GET /v1/models) but failed chat inference. Check that your key was created at build.nvidia.com or has 'Public API Endpoints' enabled.`;
        }
        checks.push({
          id: 'model_verification',
          name: 'Active Model Verification',
          pass: false,
          message: `Model '${activeModel}' rejected: ${detailMsg}`,
          details: { error: verifyRes.error },
        });
      }
    }

    // Check 5: Workspace Safety & Filesystem
    const isSys = cfg.isSystemDir;
    if (isSys) {
      checks.push({
        id: 'workspace_safety',
        name: 'Workspace Safety',
        pass: true,
        message: `System directory detected; state redirected to ~/.nomin. Direct tool execution blocked.`,
      });
    } else {
      checks.push({
        id: 'workspace_safety',
        name: 'Workspace Safety',
        pass: true,
        message: `Workspace is normal project directory: ${cfg.workdir}`,
      });
    }

    client.destroy();

    return {
      timestamp: new Date().toISOString(),
      pass: overallPass,
      activeProvider: cfg.activeProvider,
      activeModel: cfg.activeModel,
      checks,
    };
  }

  public static printReport(report: DoctorReport): void {
    console.log();
    console.log(`  ${ANSI.bold}◈ NOMIN DOCTOR SYSTEM REPORT${ANSI.reset}`);
    console.log(`  ${ANSI.dim}Timestamp: ${report.timestamp} · Provider: ${report.activeProvider}${ANSI.reset}\n`);

    for (const c of report.checks) {
      const icon = c.pass ? `${ANSI.mint}✔ PASS${ANSI.reset}` : `${ANSI.coral}✖ FAIL${ANSI.reset}`;
      console.log(`  ${icon}  ${ANSI.bold}${c.name}:${ANSI.reset} ${c.message}`);
    }

    console.log();
    if (report.pass) {
      console.log(`  ${ANSI.mint}${ANSI.bold}✔ Overall Status: READY. System is healthy and operational.${ANSI.reset}\n`);
    } else {
      console.log(`  ${ANSI.coral}${ANSI.bold}✖ Overall Status: ATTENTION REQUIRED. Address failing checks above.${ANSI.reset}\n`);
    }
  }
}
