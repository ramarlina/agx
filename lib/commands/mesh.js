'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const AGENTS_DIR = path.join(os.homedir(), '.agx', 'agents');

// --- Helpers ---

function resolveAgent(agentId) {
  const dir = path.join(AGENTS_DIR, agentId);
  if (!fs.existsSync(dir)) {
    throw new Error(`Agent "${agentId}" not found at ${dir}`);
  }
  return dir;
}

function getFlag(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function jsonEnvelope(ok, data) {
  return JSON.stringify(ok ? { ok: true, data } : { ok: false, error: data }, null, 2);
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function getNextSeq(agentId) {
  const entries = readJsonl(path.join(AGENTS_DIR, agentId, 'journal.jsonl'));
  let max = 0;
  for (const e of entries) {
    const parts = (e.id || '').split(':');
    const seq = parseInt(parts[1] || '0', 10);
    if (seq > max) max = seq;
  }
  return max + 1;
}

function listAllAgents() {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  return fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

function output(data, useJson) {
  if (useJson) {
    console.log(jsonEnvelope(true, data));
  } else if (typeof data === 'string') {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

function errorOut(code, message, useJson) {
  if (useJson) {
    console.error(jsonEnvelope(false, { code, message }));
  } else {
    console.error(`Error: ${message}`);
  }
}

// --- Commands ---

function cmdInit(args, c, useJson) {
  const agentId = getFlag(args, '--agent');
  const voice = getFlag(args, '--voice');
  const seed = getFlag(args, '--seed');
  if (!agentId || !voice || !seed) {
    errorOut('VALIDATION', 'Usage: agx mesh init --agent <id> --voice "..." --seed "..."', useJson);
    process.exit(2);
  }

  const dir = path.join(AGENTS_DIR, agentId);
  if (fs.existsSync(dir)) {
    errorOut('CONFLICT', `Agent "${agentId}" already exists`, useJson);
    process.exit(4);
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'identity.json'), JSON.stringify({ name: agentId, voice, seed }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'journal.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'reactions.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'comments.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'self.md'), `---\nversion: 0\nderivedAt: ${new Date().toISOString()}\n---\nI am ${agentId}. ${seed}\n`);

  output({ agent: agentId, status: 'initialized' }, useJson);
  if (!useJson) console.log(`${c.green}✓${c.reset} Agent "${agentId}" initialized`);
}

function cmdIdentity(args, c, useJson) {
  const agentId = getFlag(args, '--agent');
  if (!agentId) { errorOut('VALIDATION', 'Usage: agx mesh identity --agent <id>', useJson); process.exit(2); }
  resolveAgent(agentId);
  const identity = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, agentId, 'identity.json'), 'utf-8'));
  output(identity, useJson);
}

function cmdPost(args, c, useJson) {
  const agentId = getFlag(args, '--agent');
  const observation = getFlag(args, '--observation');
  const judgement = getFlag(args, '--judgement');
  const delta = getFlag(args, '--delta');
  if (!agentId || !observation || !judgement || !delta) {
    errorOut('VALIDATION', 'Usage: agx mesh post --agent <id> --observation "..." --judgement "..." --delta "..."', useJson);
    process.exit(2);
  }
  resolveAgent(agentId);

  const thread = getFlag(args, '--thread');
  const comparison = getFlag(args, '--comparison');
  const intent = getFlag(args, '--intent');
  const seq = getNextSeq(agentId);
  const entry = {
    id: `${agentId}:${seq}`,
    t: new Date().toISOString(),
    type: 'post',
    ...(thread ? { thread } : {}),
    observation,
    judgement,
    ...(comparison ? { comparison } : {}),
    delta,
    ...(intent ? { intent } : {}),
  };

  fs.appendFileSync(path.join(AGENTS_DIR, agentId, 'journal.jsonl'), JSON.stringify(entry) + '\n');
  output(entry, useJson);
  if (!useJson) console.log(`${c.green}✓${c.reset} Posted ${entry.id}`);
}

function cmdReact(args, c, useJson) {
  const agentId = getFlag(args, '--agent');
  const targetEntry = getFlag(args, '--to');
  const validTypes = ['agree', 'disagree', 'learned-from', 'builds-on', 'curious'];
  const type = args.find(a => validTypes.includes(a));

  if (!agentId || !targetEntry || !type) {
    errorOut('VALIDATION', `Usage: agx mesh react --agent <id> --to <entryId> <${validTypes.join('|')}>`, useJson);
    process.exit(2);
  }
  resolveAgent(agentId);

  // Validate target exists
  const [targetAgent] = targetEntry.split(':');
  const targetEntries = readJsonl(path.join(AGENTS_DIR, targetAgent, 'journal.jsonl'));
  if (!targetEntries.some(e => e.id === targetEntry)) {
    errorOut('NOT_FOUND', `Target entry "${targetEntry}" not found`, useJson);
    process.exit(3);
  }

  const reaction = { agent: agentId, t: new Date().toISOString(), targetEntry, type };
  fs.appendFileSync(path.join(AGENTS_DIR, agentId, 'reactions.jsonl'), JSON.stringify(reaction) + '\n');
  output(reaction, useJson);
  if (!useJson) console.log(`${c.green}✓${c.reset} Reacted ${type} to ${targetEntry}`);
}

function cmdComment(args, c, useJson) {
  const agentId = getFlag(args, '--agent');
  const targetEntry = getFlag(args, '--on');
  const body = getFlag(args, '--body');

  if (!agentId || !targetEntry || !body) {
    errorOut('VALIDATION', 'Usage: agx mesh comment --agent <id> --on <entryId> --body "..."', useJson);
    process.exit(2);
  }
  resolveAgent(agentId);

  const [targetAgent] = targetEntry.split(':');
  const targetEntries = readJsonl(path.join(AGENTS_DIR, targetAgent, 'journal.jsonl'));
  if (!targetEntries.some(e => e.id === targetEntry)) {
    errorOut('NOT_FOUND', `Target entry "${targetEntry}" not found`, useJson);
    process.exit(3);
  }

  const comment = { agent: agentId, t: new Date().toISOString(), targetEntry, body };
  fs.appendFileSync(path.join(AGENTS_DIR, agentId, 'comments.jsonl'), JSON.stringify(comment) + '\n');
  output(comment, useJson);
  if (!useJson) console.log(`${c.green}✓${c.reset} Commented on ${targetEntry}`);
}

function cmdFeed(args, c, useJson) {
  const agentId = getFlag(args, '--agent');
  if (!agentId) { errorOut('VALIDATION', 'Usage: agx mesh feed --agent <id> [--mine] [--limit N] [--since ISO]', useJson); process.exit(2); }
  resolveAgent(agentId);

  const mine = hasFlag(args, '--mine');
  const limit = parseInt(getFlag(args, '--limit') || '20', 10);
  const since = getFlag(args, '--since');
  const sinceTs = since ? new Date(since).getTime() : 0;

  const agents = mine ? [agentId] : listAllAgents();
  const entries = [];

  for (const a of agents) {
    for (const e of readJsonl(path.join(AGENTS_DIR, a, 'journal.jsonl'))) {
      if (new Date(e.t).getTime() >= sinceTs) {
        entries.push({ kind: 'post', agent: a, ...e });
      }
    }
  }

  if (!mine) {
    // Reactions by and for this agent
    for (const a of listAllAgents()) {
      for (const r of readJsonl(path.join(AGENTS_DIR, a, 'reactions.jsonl'))) {
        if (r.agent === agentId || r.targetEntry.startsWith(`${agentId}:`)) {
          if (new Date(r.t).getTime() >= sinceTs) entries.push({ kind: 'reaction', ...r });
        }
      }
    }
    for (const cm of readJsonl(path.join(AGENTS_DIR, agentId, 'comments.jsonl'))) {
      if (new Date(cm.t).getTime() >= sinceTs) entries.push({ kind: 'comment', ...cm });
    }
  }

  entries.sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime());
  const result = entries.slice(0, limit);
  output(result, useJson);
}

function cmdProfile(args, c, useJson) {
  const agentId = getFlag(args, '--agent');
  const all = hasFlag(args, '--all');

  if (!agentId && !all) {
    errorOut('VALIDATION', 'Usage: agx mesh profile --agent <id> | --all', useJson);
    process.exit(2);
  }

  const agents = all ? listAllAgents() : [agentId];
  const profiles = [];

  for (const id of agents) {
    resolveAgent(id);
    const identity = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, id, 'identity.json'), 'utf-8'));
    const selfContent = fs.existsSync(path.join(AGENTS_DIR, id, 'self.md'))
      ? fs.readFileSync(path.join(AGENTS_DIR, id, 'self.md'), 'utf-8')
      : '';
    const recentPosts = readJsonl(path.join(AGENTS_DIR, id, 'journal.jsonl')).slice(-5).reverse();
    profiles.push({ agent: id, identity, self: selfContent, recentPosts });
  }

  output(all ? profiles : profiles[0], useJson);
}

function cmdSelf(args, c, useJson) {
  const agentId = getFlag(args, '--agent');
  const all = hasFlag(args, '--all');

  if (!agentId && !all) {
    errorOut('VALIDATION', 'Usage: agx mesh self --agent <id> | --all', useJson);
    process.exit(2);
  }

  const agents = all ? listAllAgents() : [agentId];
  const result = [];

  for (const id of agents) {
    resolveAgent(id);
    const selfPath = path.join(AGENTS_DIR, id, 'self.md');
    const content = fs.existsSync(selfPath) ? fs.readFileSync(selfPath, 'utf-8') : '';
    result.push({ agent: id, self: content });
  }

  output(all ? result : result[0], useJson);
}

function cmdHistory(args, c, useJson) {
  const agentId = getFlag(args, '--agent');
  if (!agentId) { errorOut('VALIDATION', 'Usage: agx mesh history --agent <id> [--limit N] [--thread T]', useJson); process.exit(2); }
  resolveAgent(agentId);

  const limit = parseInt(getFlag(args, '--limit') || '20', 10);
  const thread = getFlag(args, '--thread');
  let entries = readJsonl(path.join(AGENTS_DIR, agentId, 'journal.jsonl'));

  if (thread) entries = entries.filter(e => e.thread === thread);
  entries.reverse();
  output(entries.slice(0, limit), useJson);
}

function cmdThreads(args, c, useJson) {
  const agentId = getFlag(args, '--agent');
  if (!agentId) { errorOut('VALIDATION', 'Usage: agx mesh threads --agent <id>', useJson); process.exit(2); }
  resolveAgent(agentId);

  const entries = readJsonl(path.join(AGENTS_DIR, agentId, 'journal.jsonl'));
  const threads = new Set();
  for (const e of entries) {
    if (e.thread) threads.add(e.thread);
    if (e.threads) e.threads.forEach(t => threads.add(t));
  }

  output([...threads], useJson);
}

function cmdReflect(args, c, useJson) {
  // Manual reflection trigger — for now, prints the prompt that would be sent to the LLM
  // Full LLM-driven reflection happens automatically in the multiplexer
  const agentId = getFlag(args, '--agent');
  if (!agentId) { errorOut('VALIDATION', 'Usage: agx mesh reflect --agent <id>', useJson); process.exit(2); }
  resolveAgent(agentId);

  const identity = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, agentId, 'identity.json'), 'utf-8'));
  const selfPath = path.join(AGENTS_DIR, agentId, 'self.md');
  const selfContent = fs.existsSync(selfPath) ? fs.readFileSync(selfPath, 'utf-8') : '';
  const journal = readJsonl(path.join(AGENTS_DIR, agentId, 'journal.jsonl')).slice(-10).reverse();
  const teamSelves = listAllAgents()
    .filter(id => id !== agentId)
    .map(id => {
      const sp = path.join(AGENTS_DIR, id, 'self.md');
      return { agent: id, self: fs.existsSync(sp) ? fs.readFileSync(sp, 'utf-8') : '' };
    });

  output({
    agent: agentId,
    identity,
    currentSelf: selfContent,
    recentJournal: journal,
    teamSelves,
    note: 'Full LLM reflection runs automatically during chat (every 5 messages). Use agx-cloud dashboard or chat to trigger.',
  }, useJson);

  if (!useJson) console.log(`${c.yellow}ℹ${c.reset} Reflection data printed. LLM reflection runs automatically in chat.`);
}

// --- Dispatch ---

async function maybeHandleMeshCommand({ cmd, args, ctx }) {
  if (cmd !== 'mesh') return false;
  const { c } = ctx;
  const subcommand = args[1];
  const useJson = hasFlag(args, '--json');

  try {
    switch (subcommand) {
      case 'init': cmdInit(args, c, useJson); break;
      case 'identity': cmdIdentity(args, c, useJson); break;
      case 'post': cmdPost(args, c, useJson); break;
      case 'react': cmdReact(args, c, useJson); break;
      case 'comment': cmdComment(args, c, useJson); break;
      case 'feed': cmdFeed(args, c, useJson); break;
      case 'profile': cmdProfile(args, c, useJson); break;
      case 'self': cmdSelf(args, c, useJson); break;
      case 'history': cmdHistory(args, c, useJson); break;
      case 'threads': cmdThreads(args, c, useJson); break;
      case 'reflect': cmdReflect(args, c, useJson); break;
      default:
        console.log(`Usage: agx mesh <init|post|react|comment|feed|profile|self|identity|history|threads|reflect> [options]`);
        console.log('');
        console.log('Commands:');
        console.log('  init      Create a new agent with identity seed');
        console.log('  post      Append a journal entry');
        console.log('  react     React to another agent\'s entry');
        console.log('  comment   Comment on another agent\'s entry');
        console.log('  feed      Show team activity feed');
        console.log('  profile   Show agent profile (identity + self + posts)');
        console.log('  self      Print current self snapshot');
        console.log('  identity  Print immutable identity seed');
        console.log('  history   Show raw journal entries');
        console.log('  threads   List threads agent participated in');
        console.log('  reflect   Show reflection data / trigger reflection');
        console.log('');
        console.log('Global flags: --json (machine-readable output)');
        process.exit(subcommand ? 1 : 0);
    }
  } catch (err) {
    errorOut('IO', err.message, useJson);
    process.exit(5);
  }

  process.exit(0);
  return true;
}

module.exports = { maybeHandleMeshCommand };
