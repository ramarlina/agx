/**
 * Verify Gate - Deterministic verification before LLM fallback.
 *
 * Strategy:
 * 1. Run deterministic checks first (tests, lint, file existence)
 * 2. Check criteria that can be verified programmatically
 * 3. Only invoke LLM for semantic/subjective criteria
 * 4. Track failures and force action after MAX_VERIFY_FAILURES
 *
 * This is a GATE, not a full stage - it decides pass/fail quickly.
 */

const fs = require('fs');
const path = require('path');
const { detectVerifyCommands, runVerifyCommands, getGitSummary } = require('./verifier');

const MAX_VERIFY_FAILURES = 3;
const DETERMINISTIC_PATTERNS = [
  // File existence patterns
  { pattern: /(?:file|files?)\s+(?:exists?|created?|present)/i, type: 'file_exists' },
  { pattern: /(?:create|add|write)\s+(?:a\s+)?(?:file|files?)/i, type: 'file_exists' },
  // Test patterns
  { pattern: /(?:tests?|specs?)\s+(?:pass|passing|succeed)/i, type: 'tests_pass' },
  { pattern: /(?:all|unit|integration)\s+tests?\s+(?:pass|green)/i, type: 'tests_pass' },
  // Build patterns
  { pattern: /(?:builds?|compiles?)\s+(?:successfully|without\s+errors?)/i, type: 'build_passes' },
  { pattern: /no\s+(?:build|compile|compilation)\s+errors?/i, type: 'build_passes' },
  // Lint patterns
  { pattern: /(?:lint|linting)\s+(?:passes?|clean|no\s+errors?)/i, type: 'lint_passes' },
  { pattern: /no\s+(?:lint|linting)\s+(?:errors?|warnings?)/i, type: 'lint_passes' },
  // Type check patterns
  { pattern: /(?:types?|typescript|typecheck)\s+(?:pass|check|valid)/i, type: 'typecheck_passes' },
  { pattern: /no\s+(?:type|typescript)\s+errors?/i, type: 'typecheck_passes' },
];

/**
 * Classify a criterion as deterministic or semantic.
 * @param {string} criterionText
 * @returns {{ type: 'deterministic' | 'semantic', checkType?: string }}
 */
function classifyCriterion(criterionText) {
  const text = String(criterionText || '').toLowerCase();
  
  for (const { pattern, type } of DETERMINISTIC_PATTERNS) {
    if (pattern.test(text)) {
      return { type: 'deterministic', checkType: type };
    }
  }
  
  return { type: 'semantic' };
}

/**
 * Extract file paths mentioned in a criterion.
 * @param {string} text
 * @returns {string[]}
 */
function extractFilePaths(text) {
  const paths = [];
  
  // Match quoted paths
  const quotedMatches = text.match(/["'`]([^"'`]+\.[a-z]{1,5})["'`]/gi) || [];
  for (const match of quotedMatches) {
    paths.push(match.slice(1, -1));
  }
  
  // Match common file patterns (without quotes)
  const filePatterns = text.match(/\b[\w\-./]+\.(js|ts|jsx|tsx|json|md|css|html|py|go|rs|yaml|yml)\b/gi) || [];
  paths.push(...filePatterns);
  
  return [...new Set(paths)];
}

/**
 * Run deterministic check for a criterion.
 * @param {string} criterionText
 * @param {object} context
 * @param {string} context.cwd - Working directory
 * @param {object} context.verifyResults - Results from runVerifyCommands
 * @returns {{ passed: boolean, reason: string, skipped?: boolean }}
 */
function runDeterministicCheck(criterionText, context = {}) {
  const { cwd = process.cwd(), verifyResults = [] } = context;
  const classification = classifyCriterion(criterionText);
  
  if (classification.type === 'semantic') {
    return { passed: false, reason: 'Requires semantic evaluation', skipped: true };
  }
  
  const checkType = classification.checkType;
  
  switch (checkType) {
    case 'file_exists': {
      const filePaths = extractFilePaths(criterionText);
      if (filePaths.length === 0) {
        return { passed: false, reason: 'No file paths detected in criterion', skipped: true };
      }
      
      const missing = [];
      for (const filePath of filePaths) {
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
        if (!fs.existsSync(fullPath)) {
          missing.push(filePath);
        }
      }
      
      if (missing.length === 0) {
        return { passed: true, reason: `All files exist: ${filePaths.join(', ')}` };
      }
      return { passed: false, reason: `Missing files: ${missing.join(', ')}` };
    }
    
    case 'tests_pass': {
      const testResult = verifyResults.find(r => r.id === 'npm_test');
      if (!testResult) {
        return { passed: false, reason: 'No test command detected', skipped: true };
      }
      if (testResult.exit_code === 0) {
        return { passed: true, reason: 'Tests passed' };
      }
      return { passed: false, reason: `Tests failed (exit ${testResult.exit_code})` };
    }
    
    case 'lint_passes': {
      const lintResult = verifyResults.find(r => r.id === 'npm_lint');
      if (!lintResult) {
        return { passed: false, reason: 'No lint command detected', skipped: true };
      }
      if (lintResult.exit_code === 0) {
        return { passed: true, reason: 'Lint passed' };
      }
      return { passed: false, reason: `Lint failed (exit ${lintResult.exit_code})` };
    }
    
    case 'typecheck_passes': {
      const typeResult = verifyResults.find(r => r.id === 'npm_typecheck');
      if (!typeResult) {
        return { passed: false, reason: 'No typecheck command detected', skipped: true };
      }
      if (typeResult.exit_code === 0) {
        return { passed: true, reason: 'Typecheck passed' };
      }
      return { passed: false, reason: `Typecheck failed (exit ${typeResult.exit_code})` };
    }
    
    case 'build_passes': {
      // Build is usually npm test or a separate build script
      // For now, skip and let semantic handle
      return { passed: false, reason: 'Build check requires semantic evaluation', skipped: true };
    }
    
    default:
      return { passed: false, reason: 'Unknown check type', skipped: true };
  }
}

/**
 * Run the verify gate on a checkpoint/execution state.
 * @param {object} options
 * @param {object[]} options.criteria - List of criteria to verify
 * @param {string} options.cwd - Working directory
 * @param {number} options.verifyFailures - Current failure count
 * @param {function} options.onLog - Logging callback
 * @returns {Promise<{ passed: boolean, results: object[], verifyFailures: number, forceAction: boolean, needsLlm: boolean }>}
 */
async function runVerifyGate(options = {}) {
  const {
    criteria = [],
    cwd = process.cwd(),
    verifyFailures = 0,
    onLog = () => {},
  } = options;
  
  // Check if we should force action due to repeated failures
  if (verifyFailures >= MAX_VERIFY_FAILURES) {
    onLog(`[verify-gate] ${verifyFailures} failures reached, forcing action`);
    return {
      passed: false,
      results: [],
      verifyFailures,
      forceAction: true,
      needsLlm: false,
      reason: `Exceeded ${MAX_VERIFY_FAILURES} verify attempts - forcing completion or block`,
    };
  }
  
  // Detect and run verification commands
  onLog('[verify-gate] Detecting verification commands...');
  const commands = detectVerifyCommands({ cwd });
  
  let verifyResults = [];
  if (commands.length > 0) {
    onLog(`[verify-gate] Running ${commands.length} verification command(s)...`);
    verifyResults = await runVerifyCommands(commands, { cwd });
    
    // Log results
    for (const result of verifyResults) {
      const status = result.exit_code === 0 ? '✓' : '✗';
      onLog(`[verify-gate] ${status} ${result.label} (exit ${result.exit_code})`);
    }
  }
  
  // Check each criterion
  const results = [];
  let allDeterministicPassed = true;
  let needsLlm = false;
  
  const normalizedCriteria = normalizeCriteria(criteria);
  
  for (const criterion of normalizedCriteria) {
    const text = typeof criterion === 'string' ? criterion : criterion.text || criterion.title || '';
    if (!text) continue;
    
    const result = runDeterministicCheck(text, { cwd, verifyResults });
    results.push({
      criterion: text,
      ...result,
    });
    
    if (result.skipped) {
      needsLlm = true;
    } else if (!result.passed) {
      allDeterministicPassed = false;
    }
  }
  
  // If all deterministic checks passed and no semantic checks needed, we pass
  const passed = allDeterministicPassed && !needsLlm;
  
  return {
    passed,
    results,
    verifyFailures: passed ? 0 : verifyFailures + 1,
    forceAction: false,
    needsLlm,
    verifyCommandResults: verifyResults,
  };
}

/**
 * Normalize criteria to consistent format.
 * @param {any} criteria
 * @returns {object[]}
 */
function normalizeCriteria(criteria) {
  if (!criteria) return [];
  if (Array.isArray(criteria)) return criteria;
  if (typeof criteria === 'object' && criteria.items) return criteria.items;
  if (typeof criteria === 'string') {
    return criteria.split(/\r?\n/).filter(Boolean).map(text => ({ text }));
  }
  return [];
}

/**
 * Build a summary of verify gate results for logging/prompt.
 * @param {object} gateResult - Result from runVerifyGate
 * @returns {string}
 */
function buildVerifyGateSummary(gateResult) {
  const lines = ['## Verify Gate Results\n'];
  
  if (gateResult.forceAction) {
    lines.push(`⚠️ **Force Action**: ${gateResult.reason}\n`);
    return lines.join('\n');
  }
  
  lines.push(`Status: ${gateResult.passed ? '✅ PASSED' : '❌ FAILED'}`);
  lines.push(`Failures: ${gateResult.verifyFailures}/${MAX_VERIFY_FAILURES}`);
  
  if (gateResult.needsLlm) {
    lines.push(`Needs LLM: Yes (semantic criteria detected)`);
  }
  
  lines.push('\n### Criteria Results\n');
  
  for (const result of gateResult.results) {
    const icon = result.skipped ? '⏭️' : result.passed ? '✅' : '❌';
    lines.push(`- ${icon} ${result.criterion}`);
    lines.push(`  ${result.reason}`);
  }
  
  if (gateResult.verifyCommandResults?.length > 0) {
    lines.push('\n### Command Results\n');
    for (const cmd of gateResult.verifyCommandResults) {
      const icon = cmd.exit_code === 0 ? '✅' : '❌';
      lines.push(`- ${icon} ${cmd.label} (${cmd.duration_ms}ms)`);
    }
  }
  
  return lines.join('\n');
}

module.exports = {
  MAX_VERIFY_FAILURES,
  classifyCriterion,
  extractFilePaths,
  runDeterministicCheck,
  runVerifyGate,
  buildVerifyGateSummary,
};
