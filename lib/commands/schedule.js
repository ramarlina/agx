'use strict';

const fs = require('fs');
const path = require('path');

/**
 * agx schedule <subcommand> [args]
 *
 * Manages prompt jobs (scheduled recurring tasks) via the agx-cloud API.
 */
async function handleSchedule({ args, ctx }) {
  const { c, cloudRequest, loadCloudConfig } = ctx;
  const sub = args[0];

  function ensureCloud() {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Board API URL not configured.${c.reset} Set AGX_BOARD_URL (legacy AGX_CLOUD_URL; default is http://localhost:41741)`);
      process.exit(1);
    }
    return config;
  }

  function flag(name, argList) {
    for (let i = 0; i < argList.length; i++) {
      if (argList[i] === `--${name}`) return argList[i + 1] || null;
    }
    return null;
  }

  function hasFlag(name, argList) {
    return argList.includes(`--${name}`);
  }

  function readPrompt(argList) {
    const file = flag('prompt-file', argList);
    if (file) {
      const resolved = path.resolve(file);
      try {
        return fs.readFileSync(resolved, 'utf8');
      } catch (err) {
        console.log(`${c.red}✗${c.reset} Could not read prompt file: ${resolved}`);
        console.log(`  ${c.dim}${err.message}${c.reset}`);
        process.exit(1);
      }
    }
    return flag('prompt', argList);
  }

  function formatRelativeTime(epochMs) {
    if (!epochMs) return '—';
    const diff = epochMs - Date.now();
    const abs = Math.abs(diff);
    if (abs < 60_000) return diff < 0 ? 'overdue' : `in ${Math.round(abs / 1000)}s`;
    if (abs < 3_600_000) return diff < 0 ? `${Math.round(abs / 60_000)}m ago` : `in ${Math.round(abs / 60_000)}m`;
    if (abs < 86_400_000) return diff < 0 ? `${Math.round(abs / 3_600_000)}h ago` : `in ${Math.round(abs / 3_600_000)}h`;
    return diff < 0 ? `${Math.round(abs / 86_400_000)}d ago` : `in ${Math.round(abs / 86_400_000)}d`;
  }

  function stateColor(state) {
    if (state === 'active') return c.green;
    if (state === 'paused') return c.yellow;
    return c.red;
  }

  function outcomeColor(outcome) {
    if (outcome === 'success') return c.green;
    if (outcome === 'failed') return c.red;
    if (outcome === 'running') return c.blue;
    if (outcome === 'cancelled') return c.yellow;
    return c.dim;
  }

  function padEnd(str, len) {
    str = String(str);
    return str.length >= len ? str : str + ' '.repeat(len - str.length);
  }

  function formatDuration(ms) {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  }

  // Resolve short IDs (prefix match) to full UUIDs
  async function resolveId(shortId) {
    if (!shortId) return shortId;
    // If it looks like a full UUID, use as-is
    if (shortId.length > 16) return shortId;
    try {
      const { jobs } = await cloudRequest('GET', '/api/prompt-jobs');
      const matches = (jobs || []).filter(j => j.id.startsWith(shortId));
      if (matches.length === 1) return matches[0].id;
      if (matches.length > 1) {
        console.log(`${c.yellow}Ambiguous ID "${shortId}" matches ${matches.length} jobs:${c.reset}`);
        for (const j of matches) console.log(`  ${j.id}  ${j.name}`);
        process.exit(1);
      }
    } catch { }
    return shortId; // fall through, let the API return 404
  }

  // ── help ─────────────────────────────────────────────────────────
  if (sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(`${c.bold}agx schedule${c.reset} — manage scheduled prompt jobs\n`);
    console.log(`  ls [--state s] [--project p]           List scheduled jobs`);
    console.log(`  create "name" --cadence c --prompt p   Create a schedule`);
    console.log(`  get <id>                               Show details`);
    console.log(`  update <id> [--name] [--cadence] ...   Update a schedule`);
    console.log(`  pause <id>                             Pause`);
    console.log(`  resume <id>                            Resume`);
    console.log(`  rm <id>                                Delete`);
    console.log(`  runs <id>                              List run history`);
    console.log(`  cancel <id>                            Cancel active run`);
    console.log(`\n${c.dim}Create flags: --prompt-file, --provider, --model, --project, --overlap, --catch-up${c.reset}`);
    process.exit(0);
  }

  // ── ls ──────────────────────────────────────────────────────────
  if (sub === 'ls' || sub === 'list' || !sub) {
    ensureCloud();
    const subArgs = args.slice(1);
    const state = flag('state', subArgs);
    const projectId = flag('project', subArgs);

    let url = '/api/prompt-jobs';
    const params = [];
    if (state) params.push(`state=${encodeURIComponent(state)}`);
    if (projectId) params.push(`projectId=${encodeURIComponent(projectId)}`);
    if (params.length) url += `?${params.join('&')}`;

    try {
      const { jobs } = await cloudRequest('GET', url);
      if (!jobs || jobs.length === 0) {
        console.log(`${c.dim}No scheduled jobs found.${c.reset}`);
        process.exit(0);
      }

      console.log(`${c.bold}Scheduled Jobs${c.reset} (${jobs.length})\n`);
      console.log(`  ${c.dim}${padEnd('ID', 10)} ${padEnd('Name', 28)} ${padEnd('Cadence', 18)} ${padEnd('State', 10)} ${padEnd('Next Run', 14)} Last${c.reset}`);
      console.log(`  ${c.dim}${'─'.repeat(90)}${c.reset}`);

      for (const job of jobs) {
        const id = (job.id || '').slice(0, 8);
        const name = (job.name || '').slice(0, 26);
        const cadence = (job.cadence || job.cronExpr || '').slice(0, 16);
        const state = job.state || '?';
        const nextRun = state === 'active' ? formatRelativeTime(job.nextRunAt) : state;
        const last = job.lastOutcome || '—';

        console.log(
          `  ${c.dim}${padEnd(id, 10)}${c.reset} ` +
          `${padEnd(name, 28)} ` +
          `${c.dim}${padEnd(cadence, 18)}${c.reset} ` +
          `${stateColor(state)}${padEnd(state, 10)}${c.reset} ` +
          `${padEnd(nextRun, 14)} ` +
          `${outcomeColor(last)}${last}${c.reset}`
        );
      }
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // ── create ──────────────────────────────────────────────────────
  if (sub === 'create' || sub === 'new') {
    ensureCloud();
    const subArgs = args.slice(1);
    const name = subArgs.find(a => !a.startsWith('-'));

    if (!name) {
      console.log(`${c.red}✗${c.reset} Usage: agx schedule create "name" --cadence "every day" --prompt "..." [--prompt-file path]`);
      process.exit(1);
    }

    const cadence = flag('cadence', subArgs);
    const prompt = readPrompt(subArgs);
    const provider = flag('provider', subArgs);
    const model = flag('model', subArgs);
    const projectId = flag('project', subArgs);
    const overlapPolicy = flag('overlap', subArgs);
    const catchUpPolicy = flag('catch-up', subArgs);

    if (!cadence) {
      console.log(`${c.red}✗${c.reset} Missing --cadence (e.g. "every day", "0 9 * * 1")`);
      process.exit(1);
    }
    if (!prompt) {
      console.log(`${c.red}✗${c.reset} Missing --prompt or --prompt-file`);
      process.exit(1);
    }

    const body = { name, cadence, prompt };
    if (provider) body.provider = provider;
    if (model) body.model = model;
    if (projectId) body.projectId = projectId;
    if (overlapPolicy) body.overlapPolicy = overlapPolicy;
    if (catchUpPolicy) body.catchUpPolicy = catchUpPolicy;

    try {
      const { job } = await cloudRequest('POST', '/api/prompt-jobs', body);
      console.log(`${c.green}✓${c.reset} Created schedule: ${c.bold}${job.name}${c.reset}`);
      console.log(`  ${c.dim}ID:${c.reset}      ${job.id}`);
      console.log(`  ${c.dim}Cadence:${c.reset} ${job.cadence || job.cronExpr}`);
      console.log(`  ${c.dim}State:${c.reset}   ${stateColor(job.state)}${job.state}${c.reset}`);
      if (job.nextRunAt) {
        console.log(`  ${c.dim}Next:${c.reset}    ${formatRelativeTime(job.nextRunAt)}`);
      }
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // ── get ─────────────────────────────────────────────────────────
  if (sub === 'get' || sub === 'show' || sub === 'info') {
    ensureCloud();
    const id = await resolveId(args[1]);
    if (!id) {
      console.log(`${c.red}✗${c.reset} Usage: agx schedule get <id>`);
      process.exit(1);
    }

    try {
      const { job } = await cloudRequest('GET', `/api/prompt-jobs/${encodeURIComponent(id)}`);
      console.log(`${c.bold}${job.name}${c.reset}`);
      console.log(`  ${c.dim}ID:${c.reset}       ${job.id}`);
      console.log(`  ${c.dim}State:${c.reset}    ${stateColor(job.state)}${job.state}${c.reset}`);
      console.log(`  ${c.dim}Cadence:${c.reset}  ${job.cadence || '—'}${job.cronExpr ? ` (${job.cronExpr})` : ''}`);
      console.log(`  ${c.dim}Provider:${c.reset} ${job.provider || '(default)'}`);
      console.log(`  ${c.dim}Model:${c.reset}    ${job.model || '(default)'}`);
      console.log(`  ${c.dim}Overlap:${c.reset}  ${job.overlapPolicy || 'skip'}`);
      console.log(`  ${c.dim}Catch-up:${c.reset} ${job.catchUpPolicy || 'fire_once'}`);
      if (job.nextRunAt) {
        console.log(`  ${c.dim}Next run:${c.reset} ${new Date(job.nextRunAt).toISOString()} (${formatRelativeTime(job.nextRunAt)})`);
      }
      if (job.lastRunAt) {
        const lastLabel = job.lastOutcome ? `${outcomeColor(job.lastOutcome)}${job.lastOutcome}${c.reset}` : '—';
        console.log(`  ${c.dim}Last run:${c.reset} ${new Date(job.lastRunAt).toISOString()} (${lastLabel})`);
      }
      console.log(`  ${c.dim}Created:${c.reset}  ${job.createdAt}`);
      if (job.projectId) {
        console.log(`  ${c.dim}Project:${c.reset}  ${job.projectId}`);
      }
      const promptPreview = (job.prompt || '').slice(0, 200);
      console.log(`\n  ${c.dim}Prompt:${c.reset}\n  ${promptPreview}${job.prompt && job.prompt.length > 200 ? `${c.dim}...${c.reset}` : ''}`);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // ── update ──────────────────────────────────────────────────────
  if (sub === 'update' || sub === 'edit') {
    ensureCloud();
    const id = await resolveId(args[1]);
    if (!id || id.startsWith('-')) {
      console.log(`${c.red}✗${c.reset} Usage: agx schedule update <id> [--name n] [--cadence c] [--prompt p] [--prompt-file f] [--provider p] [--model m]`);
      process.exit(1);
    }

    const subArgs = args.slice(2);
    const body = {};

    const name = flag('name', subArgs);
    const cadence = flag('cadence', subArgs);
    const prompt = readPrompt(subArgs);
    const provider = flag('provider', subArgs);
    const model = flag('model', subArgs);
    const projectId = flag('project', subArgs);
    const overlapPolicy = flag('overlap', subArgs);
    const catchUpPolicy = flag('catch-up', subArgs);

    if (name) body.name = name;
    if (cadence) body.cadence = cadence;
    if (prompt) body.prompt = prompt;
    if (provider) body.provider = provider;
    if (model) body.model = model;
    if (projectId) body.projectId = projectId;
    if (overlapPolicy) body.overlapPolicy = overlapPolicy;
    if (catchUpPolicy) body.catchUpPolicy = catchUpPolicy;

    if (Object.keys(body).length === 0) {
      console.log(`${c.yellow}Nothing to update.${c.reset} Pass flags like --name, --cadence, --prompt, etc.`);
      process.exit(1);
    }

    try {
      const { job } = await cloudRequest('PATCH', `/api/prompt-jobs/${encodeURIComponent(id)}`, body);
      console.log(`${c.green}✓${c.reset} Updated: ${c.bold}${job.name}${c.reset}`);
      if (cadence) console.log(`  ${c.dim}Cadence:${c.reset} ${job.cadence || job.cronExpr}`);
      if (job.nextRunAt) console.log(`  ${c.dim}Next:${c.reset}    ${formatRelativeTime(job.nextRunAt)}`);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // ── pause ───────────────────────────────────────────────────────
  if (sub === 'pause') {
    ensureCloud();
    const id = await resolveId(args[1]);
    if (!id) {
      console.log(`${c.red}✗${c.reset} Usage: agx schedule pause <id>`);
      process.exit(1);
    }

    try {
      const { job } = await cloudRequest('PATCH', `/api/prompt-jobs/${encodeURIComponent(id)}`, { state: 'paused' });
      console.log(`${c.yellow}⏸${c.reset} Paused: ${c.bold}${job.name}${c.reset}`);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // ── resume ──────────────────────────────────────────────────────
  if (sub === 'resume') {
    ensureCloud();
    const id = await resolveId(args[1]);
    if (!id) {
      console.log(`${c.red}✗${c.reset} Usage: agx schedule resume <id>`);
      process.exit(1);
    }

    try {
      const { job } = await cloudRequest('PATCH', `/api/prompt-jobs/${encodeURIComponent(id)}`, { state: 'active' });
      console.log(`${c.green}▶${c.reset} Resumed: ${c.bold}${job.name}${c.reset}`);
      if (job.nextRunAt) console.log(`  ${c.dim}Next:${c.reset} ${formatRelativeTime(job.nextRunAt)}`);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // ── rm ──────────────────────────────────────────────────────────
  if (sub === 'rm' || sub === 'delete' || sub === 'remove') {
    ensureCloud();
    const id = await resolveId(args[1]);
    if (!id) {
      console.log(`${c.red}✗${c.reset} Usage: agx schedule rm <id>`);
      process.exit(1);
    }

    try {
      // Get name first for display
      let name = id;
      try {
        const { job } = await cloudRequest('GET', `/api/prompt-jobs/${encodeURIComponent(id)}`);
        name = job.name || id;
      } catch { }

      await cloudRequest('DELETE', `/api/prompt-jobs/${encodeURIComponent(id)}`);
      console.log(`${c.green}✓${c.reset} Deleted: ${name}`);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // ── runs ────────────────────────────────────────────────────────
  if (sub === 'runs' || sub === 'history') {
    ensureCloud();
    const id = await resolveId(args[1]);
    if (!id) {
      console.log(`${c.red}✗${c.reset} Usage: agx schedule runs <id>`);
      process.exit(1);
    }

    try {
      const { runs } = await cloudRequest('GET', `/api/prompt-jobs/${encodeURIComponent(id)}/runs`);
      if (!runs || runs.length === 0) {
        console.log(`${c.dim}No runs found.${c.reset}`);
        process.exit(0);
      }

      console.log(`${c.bold}Runs${c.reset} (${runs.length})\n`);
      console.log(`  ${c.dim}${padEnd('ID', 10)} ${padEnd('Status', 12)} ${padEnd('Started', 22)} Duration${c.reset}`);
      console.log(`  ${c.dim}${'─'.repeat(60)}${c.reset}`);

      for (const run of runs) {
        const rid = (run.id || '').slice(0, 8);
        const status = run.status || '?';
        const started = run.startedAt ? new Date(run.startedAt).toISOString().replace('T', ' ').slice(0, 19) : '—';
        const duration = formatDuration(run.durationMs);

        console.log(
          `  ${c.dim}${padEnd(rid, 10)}${c.reset} ` +
          `${outcomeColor(status)}${padEnd(status, 12)}${c.reset} ` +
          `${padEnd(started, 22)} ` +
          `${duration}`
        );
      }
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // ── cancel ──────────────────────────────────────────────────────
  if (sub === 'cancel') {
    ensureCloud();
    const id = await resolveId(args[1]);
    if (!id) {
      console.log(`${c.red}✗${c.reset} Usage: agx schedule cancel <id>`);
      process.exit(1);
    }

    try {
      const { run } = await cloudRequest('POST', `/api/prompt-jobs/${encodeURIComponent(id)}/cancel`);
      console.log(`${c.yellow}✗${c.reset} Cancelled run ${(run.id || '').slice(0, 8)} for job ${id.slice(0, 8)}`);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // ── unknown subcommand ──────────────────────────────────────────
  console.log(`${c.red}✗${c.reset} Unknown schedule command: ${sub || '(none)'}`);
  console.log(`\n${c.bold}Usage:${c.reset} agx schedule <command>\n`);
  console.log(`  ls                        List scheduled jobs`);
  console.log(`  create "name" [flags]     Create a new schedule`);
  console.log(`  get <id>                  Show schedule details`);
  console.log(`  update <id> [flags]       Update a schedule`);
  console.log(`  pause <id>                Pause a schedule`);
  console.log(`  resume <id>               Resume a schedule`);
  console.log(`  rm <id>                   Delete a schedule`);
  console.log(`  runs <id>                 List run history`);
  console.log(`  cancel <id>               Cancel active run`);
  process.exit(1);
}

module.exports = { handleSchedule };
