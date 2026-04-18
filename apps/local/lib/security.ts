import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { getAllowedOrigins } from "./app-config";
import { createAdminDbClient } from "./db-adapter";
import { logger } from "@/lib/logger";

// ============ TASK SIGNING (HMAC-SHA256) ============

export interface SignableTask {
  id: string;
  user_id: string;
  content: string;
  stage: string;
  engine: string;
  provider?: string;
  model?: string;
  swarm?: boolean;
  swarm_models?: Array<{ provider: string; model: string }>;
  created_at: string;
  comments_digest?: string | null;
}

/**
 * Create HMAC-SHA256 signature for a task payload
 * Used by cloud to sign tasks before dispatch
 */
export function signTask(task: SignableTask, secret: string): string {
  const payload = JSON.stringify({
    id: task.id,
    user_id: task.user_id,
    content: task.content,
    stage: task.stage,
    engine: task.engine,
    provider: task.provider || null,
    model: task.model || null,
    swarm: task.swarm || false,
    swarm_models: task.swarm_models || null,
    comments_digest: task.comments_digest || null,
    created_at: task.created_at,
  });

  return createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}

/**
 * Verify task signature (for daemon to validate)
 * Uses timing-safe comparison to prevent timing attacks
 */
export function verifyTaskSignature(
  task: SignableTask,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = signTask(task, secret);

  try {
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );
  } catch {
    return false;
  }
}

// ============ DAEMON SECRET MANAGEMENT ============

/**
 * Generate a secure daemon secret (256-bit)
 */
export function generateDaemonSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Hash daemon secret for storage (using SHA-256)
 * Note: In production, consider bcrypt for additional security
 */
export function hashDaemonSecret(secret: string): string {
  return createHmac("sha256", process.env.SECRET_SALT || "agx-cloud-salt")
    .update(secret)
    .digest("hex");
}

/**
 * Verify daemon secret against stored hash
 */
export function verifyDaemonSecret(secret: string, hash: string): boolean {
  const expectedHash = hashDaemonSecret(secret);

  try {
    return timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(expectedHash, "hex")
    );
  } catch {
    return false;
  }
}

// ============ DANGEROUS OPERATION DETECTION ============

const DANGEROUS_PATTERNS = [
  // File system dangers
  /rm\s+(-rf?|--recursive)\s+[\/~]/i,     // rm -rf /
  /rm\s+-rf?\s+\*/i,                       // rm -rf *
  /chmod\s+(777|a\+rwx)/i,                 // chmod 777
  /chown\s+.*\s+\//i,                      // chown on root
  />\s*\/dev\/sd[a-z]/i,                   // write to disk device

  // Credential exposure
  /\.env/i,                                // .env files
  /credentials?\.json/i,                   // credential files
  /api[_-]?key/i,                          // API keys
  /secret[_-]?key/i,                       // Secret keys
  /private[_-]?key/i,                      // Private keys
  /password/i,                             // Passwords

  // Network dangers
  /curl.*\|\s*(ba)?sh/i,                   // curl | sh
  /wget.*\|\s*(ba)?sh/i,                   // wget | sh
  /nc\s+-l/i,                              // netcat listener
  /socat/i,                                // socat

  // System dangers
  /sudo\s+/i,                              // sudo commands
  /su\s+-/i,                               // su - (switch user)
  /mkfs\./i,                               // format filesystem
  /dd\s+if=/i,                             // dd command

  // Code execution
  /eval\s*\(/i,                            // eval()
  /exec\s*\(/i,                            // exec()
  /child_process/i,                        // Node child_process
  /__import__/i,                           // Python import

  // Exfiltration
  /base64.*>/i,                            // base64 encode to file
  /xxd/i,                                  // hex dump
  /tar.*-c.*\|.*curl/i,                    // tar and send
];

export interface DangerousOperationResult {
  isDangerous: boolean;
  patterns: string[];
  severity: "low" | "medium" | "high" | "critical";
}

/**
 * Check if task content contains dangerous operations
 */
export function detectDangerousOperations(content: string): DangerousOperationResult {
  const matchedPatterns: string[] = [];

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(content)) {
      matchedPatterns.push(pattern.source);
    }
  }

  // Determine severity based on the original content (not the regex source strings)
  let severity: DangerousOperationResult["severity"] = "low";

  // Critical: destructive system commands
  if (/rm\s+(-rf?|--recursive)\s*[\/~\*]|sudo\s+|mkfs\.|dd\s+if=/i.test(content)) {
    severity = "critical";
    // High: remote execution and insecure permissions
  } else if (/curl.*\|\s*(ba)?sh|wget.*\|\s*(ba)?sh|chmod\s+(777|a\+rwx)|\.env\b/i.test(content)) {
    severity = "high";
    // Medium: credential exposure
  } else if (/password|api[_-]?key|secret[_-]?key|private[_-]?key|credentials?\.json/i.test(content)) {
    severity = "medium";
  }

  return {
    isDangerous: matchedPatterns.length > 0,
    patterns: matchedPatterns,
    severity,
  };
}

// ============ AUDIT LOGGING ============

export interface AuditLogEntry {
  user_id: string;
  task_id: string;
  action: "dispatch" | "execute" | "complete" | "reject" | "fail";
  payload: Record<string, unknown>;
  signature: string;
  ip_address?: string;
  user_agent?: string;
  result?: "pending" | "success" | "rejected" | "failed";
}

/**
 * Write to immutable audit log
 * Only service role can write to this table
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<string> {
  const db = createAdminDbClient();

  const { data, error } = await db
    .from("task_audit_log")
    .insert({
      user_id: entry.user_id,
      task_id: entry.task_id,
      action: entry.action,
      payload: entry.payload,
      signature: entry.signature,
      ip_address: entry.ip_address,
      user_agent: entry.user_agent,
      result: entry.result || "pending",
    })
    .select("id")
    .single();

  if (error) {
    logger.error("Failed to write audit log", logger.formatError(error));
    throw new Error("Audit log write failed");
  }

  return data.id;
}

/**
 * Update audit log with execution result
 */
export async function updateAuditLogResult(
  auditId: string,
  result: "success" | "rejected" | "failed",
  executedAt?: Date
): Promise<void> {
  const db = createAdminDbClient();

  const { error } = await db
    .from("task_audit_log")
    .update({
      result,
      executed_at: executedAt?.toISOString() || new Date().toISOString(),
    })
    .eq("id", auditId);

  if (error) {
    logger.error("Failed to update audit log", logger.formatError(error));
    throw new Error("Audit log update failed");
  }
}

/**
 * Get audit logs for a user
 */
export async function getAuditLogs(
  userId: string,
  options?: { limit?: number; offset?: number; taskId?: string }
): Promise<AuditLogEntry[]> {
  const db = createAdminDbClient();

  let query = db
    .from("task_audit_log")
    .select("*")
    .eq("user_id", userId)
    .order("dispatched_at", { ascending: false });

  if (options?.taskId) {
    query = query.eq("task_id", options.taskId);
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
  }

  const { data, error } = await query;

  if (error) {
    logger.error("Failed to get audit logs", logger.formatError(error));
    throw error;
  }

  return data || [];
}

// ============ RATE LIMITING ============

export interface RateLimitConfig {
  endpoint: string;
  maxRequests: number;
  windowSeconds: number;
}

// Default rate limits per endpoint
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  "tasks/create": { endpoint: "tasks/create", maxRequests: 10, windowSeconds: 60 },
  "chat/message": { endpoint: "chat/message", maxRequests: 100, windowSeconds: 3600 },
  "daemon/poll": { endpoint: "daemon/poll", maxRequests: 60, windowSeconds: 60 },
  "default": { endpoint: "default", maxRequests: 100, windowSeconds: 60 },
};

/**
 * Check if request is within rate limit
 * Returns true if allowed, false if rate limited
 */
export async function checkRateLimit(
  userId: string,
  endpoint: string
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  // Rate limiting disabled
  return {
    allowed: true,
    remaining: 999999999,
    resetAt: new Date(Date.now() + 60000),
  };
}

// ============ ORIGIN VALIDATION ============

const ALLOWED_ORIGINS = [
  "https://agx-cloud.vercel.app",
  ...getAllowedOrigins(),
];

/**
 * Validate request origin
 */
export function isValidOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

/**
 * Validate bearer token and get user
 */
export async function validateBearerToken(
  authHeader: string | null
): Promise<{ valid: boolean; userId?: string }> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { valid: false };
  }

  const token = authHeader.slice(7);
  const db = createAdminDbClient();

  const { data: { user }, error } = await db.auth.getUser(token);

  if (error || !user) {
    return { valid: false };
  }

  return { valid: true, userId: user.id };
}
