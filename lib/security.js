/**
 * AGX Security Module
 * 
 * Handles:
 * - Daemon secret generation and verification
 * - Task signature verification (HMAC-SHA256)
 * - Dangerous operation detection
 * - Local audit logging
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Config paths
const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.agx');
const AUDIT_LOG_FILE = path.join(CONFIG_DIR, 'audit.log');
const SECURITY_CONFIG_FILE = path.join(CONFIG_DIR, 'security.json');

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

// ============ DAEMON SECRET ============

/**
 * Generate a secure daemon secret (256-bit)
 */
function generateDaemonSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Load security config
 */
function loadSecurityConfig() {
  try {
    if (fs.existsSync(SECURITY_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(SECURITY_CONFIG_FILE, 'utf8'));
    }
  } catch (err) {
    console.error(`${c.dim}Failed to load security config: ${err.message}${c.reset}`);
  }
  return null;
}

/**
 * Save security config
 */
function saveSecurityConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(SECURITY_CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/**
 * Get or generate daemon secret
 * Returns the secret (for signing operations)
 */
function getDaemonSecret() {
  const config = loadSecurityConfig();
  if (config?.daemonSecret) {
    return config.daemonSecret;
  }
  return null;
}

/**
 * Setup daemon secret (called during cloud login)
 * Returns { secret, isNew }
 */
async function setupDaemonSecret(options = {}) {
  const { force = false, cloudApiUrl = null, cloudToken = null } = options;
  
  let config = loadSecurityConfig() || {};
  
  // If we already have a secret and not forcing, return existing.
  // Best-effort: sync signing key from cloud if missing.
  if (config.daemonSecret && !force) {
    if (cloudApiUrl && cloudToken && !config.daemonSigningKey) {
      try {
        const verifyRes = await fetch(`${cloudApiUrl}/api/auth/daemon-secret`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cloudToken}`,
          },
          body: JSON.stringify({
            action: 'verify',
            secret: config.daemonSecret,
          }),
        });
        if (verifyRes.ok) {
          const verifyData = await verifyRes.json().catch(() => ({}));
          if (verifyData?.valid && verifyData?.signing_key) {
            config.daemonSigningKey = verifyData.signing_key;
            saveSecurityConfig(config);
          }
        }
      } catch { }
    }
    return { secret: config.daemonSecret, isNew: false };
  }
  
  // Generate new secret
  const newSecret = generateDaemonSecret();
  config.daemonSecret = newSecret;
  config.secretCreatedAt = new Date().toISOString();
  
  if (force && config.daemonSecret) {
    config.secretRotatedAt = new Date().toISOString();
  }
  
  // Save locally first
  saveSecurityConfig(config);
  
  // If cloud credentials provided, register with cloud
  if (cloudApiUrl && cloudToken) {
    try {
      const response = await fetch(`${cloudApiUrl}/api/auth/daemon-secret`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cloudToken}`,
        },
        body: JSON.stringify({ 
          action: force ? 'rotate' : 'generate',
          // Register the local daemon secret so cloud and daemon sign/verify with the same key material.
          secret: newSecret,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error(`${c.yellow}Warning: Could not register secret with cloud: ${error.error || response.status}${c.reset}`);
      } else {
        const data = await response.json().catch(() => ({}));
        if (data?.signing_key) {
          config.daemonSigningKey = data.signing_key;
          saveSecurityConfig(config);
        }
      }
    } catch (err) {
      console.error(`${c.yellow}Warning: Could not connect to cloud: ${err.message}${c.reset}`);
    }
  }
  
  return { secret: newSecret, isNew: true };
}

// ============ TASK SIGNING ============

/**
 * Sign a task payload with the daemon secret (for verification)
 */
function signTask(task, secret) {
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
  
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

/**
 * Verify task signature
 * Returns true if signature is valid
 */
function verifyTaskSignature(task, signature, secret) {
  if (!signature || !secret) {
    return false;
  }
  
  const expectedSignature = signTask(task, secret);
  
  // Use timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

// ============ DANGEROUS OPERATION DETECTION ============

const DANGEROUS_PATTERNS = [
  // File system dangers (critical)
  { pattern: /rm\s+(-rf?|--recursive)\s+[\/~]/i, severity: 'critical', desc: 'Recursive delete on root/home' },
  { pattern: /rm\s+-rf?\s+\*/i, severity: 'critical', desc: 'Recursive delete with wildcard' },
  { pattern: />\s*\/dev\/sd[a-z]/i, severity: 'critical', desc: 'Write to disk device' },
  { pattern: /mkfs\./i, severity: 'critical', desc: 'Format filesystem' },
  { pattern: /dd\s+if=.*of=\/dev/i, severity: 'critical', desc: 'Direct disk write' },
  
  // System dangers (high)
  { pattern: /chmod\s+(777|a\+rwx)/i, severity: 'high', desc: 'World-writable permissions' },
  { pattern: /chown\s+.*\s+\//i, severity: 'high', desc: 'Change ownership on root' },
  { pattern: /sudo\s+/i, severity: 'high', desc: 'Sudo command' },
  { pattern: /su\s+-/i, severity: 'high', desc: 'Switch user' },
  
  // Network dangers (high)
  { pattern: /curl.*\|\s*(ba)?sh/i, severity: 'high', desc: 'Curl pipe to shell' },
  { pattern: /wget.*\|\s*(ba)?sh/i, severity: 'high', desc: 'Wget pipe to shell' },
  { pattern: /nc\s+-[le]/i, severity: 'high', desc: 'Netcat listener' },
  
  // Credential exposure (medium)
  { pattern: /\.env/i, severity: 'medium', desc: 'Environment file access' },
  { pattern: /credentials?\.json/i, severity: 'medium', desc: 'Credentials file' },
  { pattern: /api[_-]?key/i, severity: 'medium', desc: 'API key reference' },
  { pattern: /secret[_-]?key/i, severity: 'medium', desc: 'Secret key reference' },
  { pattern: /private[_-]?key/i, severity: 'medium', desc: 'Private key reference' },
  { pattern: /password/i, severity: 'medium', desc: 'Password reference' },
  
  // Code execution (medium)
  { pattern: /eval\s*\(/i, severity: 'medium', desc: 'Eval function' },
  { pattern: /exec\s*\(/i, severity: 'medium', desc: 'Exec function' },
  { pattern: /__import__/i, severity: 'medium', desc: 'Python dynamic import' },
];

/**
 * Detect dangerous operations in content
 * Returns { isDangerous, matches: [{ pattern, severity, desc }], maxSeverity }
 */
function detectDangerousOperations(content) {
  const matches = [];
  
  for (const { pattern, severity, desc } of DANGEROUS_PATTERNS) {
    if (pattern.test(content)) {
      matches.push({ pattern: pattern.source, severity, desc });
    }
  }
  
  // Determine max severity
  let maxSeverity = 'low';
  if (matches.some(m => m.severity === 'critical')) {
    maxSeverity = 'critical';
  } else if (matches.some(m => m.severity === 'high')) {
    maxSeverity = 'high';
  } else if (matches.some(m => m.severity === 'medium')) {
    maxSeverity = 'medium';
  }
  
  return {
    isDangerous: matches.length > 0,
    matches,
    maxSeverity,
  };
}

/**
 * Prompt user for confirmation on dangerous operations
 * Returns true if user confirms, false otherwise
 */
async function confirmDangerousOperation(task, dangerInfo) {
  const { matches, maxSeverity } = dangerInfo;
  
  const severityColor = {
    critical: c.red,
    high: c.red,
    medium: c.yellow,
  }[maxSeverity] || c.yellow;
  
  console.log(`\n${severityColor}${c.bold}⚠ DANGEROUS OPERATION DETECTED${c.reset}\n`);
  console.log(`Task: ${c.bold}${task.title || 'Untitled'}${c.reset}`);
  console.log(`Severity: ${severityColor}${maxSeverity.toUpperCase()}${c.reset}\n`);
  
  console.log('Detected patterns:');
  for (const match of matches) {
    const icon = match.severity === 'critical' ? '🚫' : match.severity === 'high' ? '⚠️' : '⚡';
    console.log(`  ${icon} ${match.desc} (${match.severity})`);
  }
  
  console.log(`\n${c.dim}The task contains potentially dangerous operations.${c.reset}`);
  console.log(`${c.dim}Review carefully before proceeding.${c.reset}\n`);
  
  // If critical, require explicit confirmation
  if (maxSeverity === 'critical') {
    console.log(`${c.red}This operation is CRITICAL and could cause data loss.${c.reset}`);
    console.log(`Type ${c.bold}CONFIRM${c.reset} to proceed, or anything else to skip:\n`);
    
    const answer = await prompt('> ');
    return answer?.trim() === 'CONFIRM';
  }
  
  // For high/medium, simple y/n
  const answer = await prompt(`Proceed? (y/N): `);
  return answer?.toLowerCase() === 'y' || answer?.toLowerCase() === 'yes';
}

// Simple prompt helper
function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// ============ LOCAL AUDIT LOGGING ============

/**
 * Write to local audit log
 */
function writeAuditLog(entry) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  
  const logEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };
  
  const line = JSON.stringify(logEntry) + '\n';
  fs.appendFileSync(AUDIT_LOG_FILE, line, { mode: 0o600 });
}

/**
 * Log task execution
 */
function logTaskExecution(task, options = {}) {
  const { 
    action = 'execute',
    result = 'pending',
    signatureValid = null,
    dangerousOps = null,
    skipped = false,
    error = null,
  } = options;
  
  writeAuditLog({
    action,
    taskId: task.id,
    title: task.title,
    stage: task.stage,
    engine: task.engine,
    project: task.project,
    signatureValid,
    dangerousOps: dangerousOps ? {
      detected: dangerousOps.isDangerous,
      severity: dangerousOps.maxSeverity,
      patterns: dangerousOps.matches.map(m => m.desc),
    } : null,
    result,
    skipped,
    error: error?.message || error,
  });
}

/**
 * Read recent audit log entries
 */
function readAuditLog(options = {}) {
  const { limit = 50, taskId = null } = options;
  
  if (!fs.existsSync(AUDIT_LOG_FILE)) {
    return [];
  }
  
  const lines = fs.readFileSync(AUDIT_LOG_FILE, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean);
  
  let entries = lines.map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
  
  // Filter by taskId if provided
  if (taskId) {
    entries = entries.filter(e => e.taskId === taskId);
  }
  
  // Return most recent
  return entries.slice(-limit);
}

// ============ SECURITY CHECKS FOR WORKER ============

/**
 * Full security check before executing a task
 * Returns { canExecute, reason, requiresConfirmation }
 */
async function securityCheck(task, options = {}) {
  const { 
    requireSignature = true,
    allowDangerous = false,
    interactive = true,
  } = options;
  
  const result = {
    canExecute: true,
    reason: null,
    signatureValid: null,
    dangerousOps: null,
    requiresConfirmation: false,
  };
  
  // 1. Verify signature if required
  if (requireSignature && task.signature) {
    const config = loadSecurityConfig() || {};
    const candidateKeys = [];
    if (config.daemonSigningKey) candidateKeys.push(config.daemonSigningKey);
    if (config.daemonSecret) candidateKeys.push(config.daemonSecret);

    if (candidateKeys.length === 0) {
      result.canExecute = false;
      result.reason = 'No daemon secret configured. Run: agx cloud login';
      return result;
    }
    
    const valid = candidateKeys.some((key) => verifyTaskSignature(task, task.signature, key));
    result.signatureValid = valid;
    
    if (!valid) {
      result.canExecute = false;
      result.reason = 'Invalid task signature - task may have been tampered with';
      return result;
    }
  } else if (requireSignature && !task.signature) {
    // Unsigned task - warn but allow (for backwards compatibility)
    console.log(`${c.yellow}⚠ Warning: Task is unsigned${c.reset}`);
    result.signatureValid = null;
  }
  
  // 2. Check for dangerous operations
  const dangerCheck = detectDangerousOperations(task.content);
  result.dangerousOps = dangerCheck;
  
  if (dangerCheck.isDangerous) {
    // Critical operations are blocked by default
    if (dangerCheck.maxSeverity === 'critical' && !allowDangerous) {
      result.canExecute = false;
      result.reason = `Task blocked: contains critical dangerous operations`;
      return result;
    }
    
    // High/medium require confirmation if interactive
    if (interactive && !allowDangerous) {
      result.requiresConfirmation = true;
    }
  }
  
  return result;
}

module.exports = {
  // Daemon secret
  generateDaemonSecret,
  getDaemonSecret,
  setupDaemonSecret,
  loadSecurityConfig,
  saveSecurityConfig,
  
  // Task signing
  signTask,
  verifyTaskSignature,
  
  // Dangerous operation detection
  detectDangerousOperations,
  confirmDangerousOperation,
  
  // Audit logging
  writeAuditLog,
  logTaskExecution,
  readAuditLog,
  
  // Security check
  securityCheck,
  
  // Constants
  DANGEROUS_PATTERNS,
  AUDIT_LOG_FILE,
  SECURITY_CONFIG_FILE,
};
