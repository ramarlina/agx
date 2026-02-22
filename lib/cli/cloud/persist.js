/* eslint-disable no-console */
'use strict';

function createCloudPersistenceHelpers(env) {
  const { fs, path, buildLocalRunIndexEntry } = env || {};

  async function appendRunContainerLog(runContainerPath, relativePath, text) {
    if (!runContainerPath || !relativePath || !text) return;
    const filePath = path.join(runContainerPath, relativePath);
    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      const payload = String(text);
      await fs.promises.appendFile(filePath, payload.endsWith('\n') ? payload : `${payload}\n`, 'utf8');
    } catch { }
  }

  async function finalizeRunSafe(storage, run, decision) {
    if (!storage || !run || run.finalized) return;
    try {
      await storage.finalizeRun(run, decision);
    } catch { }
  }

  async function persistIterationArtifacts(storage, { runContainerPath, executeRun, verifyRun, decision, verifyCommands, verifyResults, gitSummary }) {
    if (!storage) return;

    const safeText = (v) => (typeof v === 'string' ? v : '');

    // Ensure the run container has a plan folder so the layout is always:
    //   <task_slug>/<run_id>/{plan,execute,verify}
    if (runContainerPath) {
      try {
        await fs.promises.mkdir(path.join(runContainerPath, 'plan'), { recursive: true });
      } catch { }
    }

    const planMd = safeText(decision?.plan_md) || '# Plan\n\n- (not provided)\n';
    const implMd = safeText(decision?.implementation_summary_md) || '# Implementation Summary\n\n- (not provided)\n';
    const verificationMd = safeText(decision?.validation_md || decision?.verification_md) || '# Validation\n\nDONE: no\n\n- (not provided)\n';

    // Write the plan markdown into the plan folder (not under execute/verify).
    if (runContainerPath) {
      try {
        await fs.promises.writeFile(path.join(runContainerPath, 'plan', 'plan.md'), planMd.endsWith('\n') ? planMd : `${planMd}\n`, 'utf8');
      } catch { }
    }

    // Implementation summary belongs with the execution phase.
    if (executeRun?.paths?.artifacts) {
      try {
        await storage.writeArtifact(executeRun, 'implementation_summary.md', implMd.endsWith('\n') ? implMd : `${implMd}\n`);
      } catch (err) {
        await appendRunContainerLog(runContainerPath, 'daemon/artifact_errors.log', `[${new Date().toISOString()}] execute artifact write failed: ${err?.message || err}`);
      }
    }

    // Verification outputs (including command logs) belong with the verify phase.
    if (verifyRun?.paths?.artifacts) {
      try {
        await storage.writeArtifact(verifyRun, 'verification.md', verificationMd.endsWith('\n') ? verificationMd : `${verificationMd}\n`);
      } catch (err) {
        await appendRunContainerLog(runContainerPath, 'daemon/artifact_errors.log', `[${new Date().toISOString()}] verify artifact write failed (verification.md): ${err?.message || err}`);
      }

      const payload = {
        commands: Array.isArray(verifyCommands) ? verifyCommands : [],
        results: Array.isArray(verifyResults) ? verifyResults.map((r) => ({
          id: r.id,
          label: r.label,
          cmd: r.cmd,
          args: r.args,
          cwd: r.cwd,
          exit_code: r.exit_code,
          duration_ms: r.duration_ms,
          error: r.error,
        })) : [],
        git: gitSummary || null,
      };

      try {
        await storage.writeArtifact(verifyRun, 'verify_commands.json', JSON.stringify(payload, null, 2) + '\n');
      } catch (err) {
        await appendRunContainerLog(runContainerPath, 'daemon/artifact_errors.log', `[${new Date().toISOString()}] verify artifact write failed (verify_commands.json): ${err?.message || err}`);
      }

      if (Array.isArray(verifyResults)) {
        for (let i = 0; i < verifyResults.length; i += 1) {
          const r = verifyResults[i];
          const base = `verify_results/${String(i + 1).padStart(2, '0')}-${String(r.id || `cmd_${i + 1}`).replace(/[^a-z0-9_-]/gi, '_')}`;
          try { await storage.writeArtifact(verifyRun, `${base}.stdout.txt`, (r.stdout || '').toString()); } catch { }
          try { await storage.writeArtifact(verifyRun, `${base}.stderr.txt`, (r.stderr || '').toString()); } catch { }
        }
      }

      if (gitSummary?.status_porcelain) {
        try { await storage.writeArtifact(verifyRun, 'git_status.txt', String(gitSummary.status_porcelain)); } catch { }
      }
      if (gitSummary?.diff_stat) {
        try { await storage.writeArtifact(verifyRun, 'git_diffstat.txt', String(gitSummary.diff_stat)); } catch { }
      }
    }
  }

  async function buildRunIndexEntrySafe(storage, verifyRun, localDecisionStatus) {
    if (!storage || !verifyRun || !localDecisionStatus) return null;
    if (typeof buildLocalRunIndexEntry !== 'function') return null;
    try {
      return await buildLocalRunIndexEntry(storage, verifyRun, localDecisionStatus);
    } catch {
      return null;
    }
  }

  return {
    appendRunContainerLog,
    finalizeRunSafe,
    persistIterationArtifacts,
    buildRunIndexEntrySafe,
  };
}

module.exports = { createCloudPersistenceHelpers };
