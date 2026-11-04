/**
 * Nomin Code: Verifier Gate, Definition-of-Done (DoD) & Proof Engine Types
 *
 * Defines machine-verifiable acceptance criteria contracts, AST audit results,
 * and the tamper-evident TaskCompletionCertificate.
 */

export interface DiffSummary {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface CriterionResult {
  command: string;
  exitCode: number;
  stdoutHash: string;
  durationMs: number;
}

export interface AstAudit {
  clean: boolean;
  stubsFound: string[];
  testsSkipped: string[];
}

/**
 * Tamper-Evident Task Completion Certificate.
 * Contains machine-verifiable proof of work and a SHA-256 digital signature.
 */
export interface TaskCompletionCertificate {
  taskId: string;
  baseSha: string;
  headSha: string;
  diffSummary: DiffSummary;
  criteriaResults: CriterionResult[];
  astAudit: AstAudit;
  verifierRole: string;
  timestamp: string;
  verified: boolean;
  signature: string;
}

export interface FinalGateOptions {
  worktreePath?: string;
  diffText?: string;
  baseSha?: string;
  headSha?: string;
  timeoutOverrideSeconds?: number;
  failFast?: boolean;
}

export interface FinalGateResult {
  approved: boolean;
  taskId: string;
  reason: string;
  feedback?: string;
  integrityViolation: boolean;
  verifiedCriteria: string[];
  failedCriteria: string[];
  certificate: TaskCompletionCertificate;
  certificatePath?: string;
  evidenceLogs: Array<{
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}

export interface CertificateVerificationResult {
  valid: boolean;
  expectedSignature: string;
  actualSignature: string;
  reason?: string;
}
