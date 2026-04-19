'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawn } = require('child_process');

const DEFAULT_PROMPT = `You are reading a single merged pull request. The file you are given starts with YAML frontmatter (PR metadata) followed by the unified diff.

Analyze it from a product, positioning, and marketing standpoint. Be concrete — reference what the diff actually changes, not generic platitudes. Output markdown with these sections:

## What it does
1-3 sentences in plain English. What user-visible capability or internal capability changed?

## Product angle
What user problem or job-to-be-done does this serve? Who benefits and how?

## Positioning angle
How does this sharpen (or muddy) what the product is vs. alternatives? What category signal does it send?

## Marketing / narrative hook
One concrete story, demo, tweet, or changelog line this could fuel. Skip if the change is purely internal plumbing — say so.

## Signal strength
low | medium | high — how share-worthy is this for external narrative? One-line justification.

Keep the whole response under ~250 words. Skip filler.`;

function flag(name, argList) {
  for (let i = 0; i < argList.length; i++) {
    if (argList[i] === `--${name}`) return argList[i + 1] || null;
  }
  return null;
}

function hasFlag(name, argList) {
  return argList.includes(`--${name}`);
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();
}

function resolveRepo(repoPath) {
  const abs = path.resolve(repoPath || process.cwd());
  if (!fs.existsSync(abs)) throw new Error(`Path not found: ${abs}`);
  let root;
  try {
    root = sh('git', ['-C', abs, 'rev-parse', '--show-toplevel']);
  } catch {
    throw new Error(`Not a git repository: ${abs}`);
  }
  let slug;
  try {
    slug = sh('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { cwd: root });
  } catch {
    const url = sh('git', ['-C', root, 'remote', 'get-url', 'origin']);
    const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
    if (!m) throw new Error(`Could not derive owner/name from remote: ${url}`);
    slug = `${m[1]}/${m[2]}`;
  }
  return { root, slug };
}

function storageDir(slug, override) {
  if (override) return path.resolve(override);
  const safe = slug.replace('/', '__');
  return path.join(os.homedir(), '.agx', 'narrate-prs', safe);
}

function loadState(dir) {
  const p = path.join(dir, 'state.json');
  if (!fs.existsSync(p)) return { processed_prs: {}, last_merged_at: null };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return { processed_prs: {}, last_merged_at: null }; }
}

function saveState(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
}

function buildFrontmatter(meta) {
  const esc = (s) => JSON.stringify(s ?? '');
  const lines = ['---'];
  lines.push(`number: ${meta.number}`);
  lines.push(`title: ${esc(meta.title)}`);
  lines.push(`url: ${meta.url}`);
  lines.push(`state: ${meta.state}`);
  lines.push(`author: ${meta.author?.login || ''}`);
  lines.push(`created_at: ${meta.createdAt}`);
  lines.push(`merged_at: ${meta.mergedAt || ''}`);
  lines.push(`base: ${meta.baseRefName}`);
  lines.push(`head: ${meta.headRefName}`);
  lines.push(`merge_commit: ${meta.mergeCommit?.oid || ''}`);
  lines.push(`additions: ${meta.additions}`);
  lines.push(`deletions: ${meta.deletions}`);
  lines.push(`changed_files: ${meta.changedFiles}`);
  lines.push(`labels: [${(meta.labels || []).map(l => l.name).join(', ')}]`);
  if (meta.commits?.length) {
    lines.push('commits:');
    for (const com of meta.commits) {
      lines.push(`  - oid: ${com.oid}`);
      lines.push(`    date: ${com.committedDate || com.authoredDate || ''}`);
      lines.push(`    message: ${esc(com.messageHeadline)}`);
    }
  }
  if (meta.body) {
    lines.push('body: |');
    for (const l of meta.body.split('\n')) lines.push(`  ${l}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function fetchMergedPrNumbers(slug, since) {
  const args = ['pr', 'list', '--repo', slug, '--state', 'merged', '--limit', '1000', '--json', 'number,mergedAt'];
  if (since) args.push('--search', `merged:>${since}`);
  const out = sh('gh', args);
  return JSON.parse(out);
}

function fetchPrMeta(slug, number) {
  const fields = 'number,title,author,state,mergedAt,createdAt,baseRefName,headRefName,labels,url,mergeCommit,additions,deletions,changedFiles,body,commits';
  return JSON.parse(sh('gh', ['pr', 'view', String(number), '--repo', slug, '--json', fields]));
}

function fetchPrDiff(slug, number) {
  return sh('gh', ['pr', 'diff', String(number), '--repo', slug], { maxBuffer: 50 * 1024 * 1024 });
}

function runAgxAgent({ prompt, provider, model }) {
  return new Promise((resolve, reject) => {
    const args = [provider, '-y', '--model', model, '-p', prompt];
    const child = spawn('agx', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`agx ${provider} exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

async function processPr({ slug, number, dir, prompt, provider, model }) {
  const meta = fetchPrMeta(slug, number);
  const diffBody = fetchPrDiff(slug, number);
  const frontmatter = buildFrontmatter(meta);

  const diffsDir = path.join(dir, 'diffs');
  const narrDir = path.join(dir, 'narratives');
  fs.mkdirSync(diffsDir, { recursive: true });
  fs.mkdirSync(narrDir, { recursive: true });

  const diffPath = path.join(diffsDir, `pr-${number}.diff`);
  fs.writeFileSync(diffPath, `${frontmatter}\n${diffBody || '# (no diff available)'}\n`);

  const payload = fs.readFileSync(diffPath, 'utf8').slice(0, 200000);
  const fullPrompt = `${prompt}\n\n---\n\n${payload}`;
  const analysis = await runAgxAgent({ prompt: fullPrompt, provider, model });

  const narrPath = path.join(narrDir, `pr-${number}.md`);
  fs.writeFileSync(narrPath, `${frontmatter}\n\n${analysis}`);
  return { diffPath, narrPath, meta };
}

async function runBatch(items, concurrency, worker) {
  const results = [];
  let idx = 0;
  const total = items.length;
  let completed = 0;
  const runOne = async () => {
    while (idx < items.length) {
      const my = idx++;
      const item = items[my];
      try {
        const r = await worker(item);
        completed++;
        console.log(`[${completed}/${total}] pr-${item.number} ✓`);
        results.push({ ok: true, number: item.number, result: r });
      } catch (err) {
        completed++;
        console.log(`[${completed}/${total}] pr-${item.number} ✗ ${err.message.split('\n')[0]}`);
        results.push({ ok: false, number: item.number, error: err.message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runOne));
  return results;
}

async function cmdRun({ repoPath, args, c }) {
  const { root, slug } = resolveRepo(repoPath);
  const dir = storageDir(slug, flag('output-dir', args));
  fs.mkdirSync(dir, { recursive: true });

  const provider = flag('provider', args) || flag('P', args) || 'z';
  const model = flag('model', args) || 'sonnet';
  const concurrency = parseInt(flag('concurrency', args) || '5', 10);
  const limit = parseInt(flag('limit', args) || '0', 10);
  const force = hasFlag('force', args);
  const dryRun = hasFlag('dry-run', args);
  const since = flag('since', args);
  const promptFile = flag('prompt-file', args);
  const prompt = promptFile ? fs.readFileSync(path.resolve(promptFile), 'utf8') : DEFAULT_PROMPT;

  const state = force ? { processed_prs: {}, last_merged_at: null } : loadState(dir);

  console.log(`${c.cyan}narrate-prs${c.reset} ${slug} → ${dir}`);
  console.log(`  root: ${root}`);

  const watermark = since || state.last_merged_at;
  const allPrs = fetchMergedPrNumbers(slug, watermark);
  const pending = allPrs
    .filter(p => force || !state.processed_prs[p.number])
    .sort((a, b) => new Date(a.mergedAt) - new Date(b.mergedAt));

  const queue = limit > 0 ? pending.slice(0, limit) : pending;
  console.log(`  ${allPrs.length} PRs from gh, ${pending.length} unprocessed, ${queue.length} queued (provider=${provider}, model=${model}, concurrency=${concurrency})`);

  if (dryRun) {
    for (const p of queue) console.log(`  would process pr-${p.number} (merged ${p.mergedAt})`);
    return;
  }
  if (queue.length === 0) {
    console.log(`${c.green}✓${c.reset} up to date`);
    return;
  }

  const results = await runBatch(queue, concurrency, async (item) => {
    const r = await processPr({ slug, number: item.number, dir, prompt, provider, model });
    state.processed_prs[item.number] = {
      merged_at: item.mergedAt,
      analyzed_at: new Date().toISOString(),
    };
    if (!state.last_merged_at || new Date(item.mergedAt) > new Date(state.last_merged_at)) {
      state.last_merged_at = item.mergedAt;
    }
    saveState(dir, state);
    return r;
  });

  const ok = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const okNums = results.filter(r => r.ok).map(r => `pr-${r.number}`).join(', ');
  console.log(`\n${slug}: ${ok} new PR${ok === 1 ? '' : 's'} analyzed${okNums ? ` (${okNums})` : ''}, ${Object.keys(state.processed_prs).length - ok} previously done, ${failed} failed.`);
  console.log(`Output: ${path.join(dir, 'narratives')}/`);
  if (failed > 0) process.exitCode = 1;
}

function cmdLs({ repoPath, args, c }) {
  const { slug } = resolveRepo(repoPath);
  const dir = storageDir(slug, flag('output-dir', args));
  const state = loadState(dir);
  const narrDir = path.join(dir, 'narratives');
  const diffsDir = path.join(dir, 'diffs');
  const narratives = fs.existsSync(narrDir) ? fs.readdirSync(narrDir).filter(f => f.endsWith('.md')).sort() : [];
  const diffs = fs.existsSync(diffsDir) ? fs.readdirSync(diffsDir).filter(f => f.endsWith('.diff')).sort() : [];

  console.log(`${c.cyan}${slug}${c.reset}`);
  console.log(`  dir:       ${dir}`);
  console.log(`  state:     ${Object.keys(state.processed_prs).length} processed PRs`);
  console.log(`  watermark: ${state.last_merged_at || '(none)'}`);
  console.log(`  diffs:     ${diffs.length} files in ${diffsDir}`);
  console.log(`  narratives:${narratives.length} files in ${narrDir}`);
  if (hasFlag('json', args)) {
    console.log(JSON.stringify({ slug, dir, state, narratives, diffs }, null, 2));
    return;
  }
  if (narratives.length && hasFlag('files', args)) {
    console.log('\nNarratives:');
    for (const f of narratives) console.log(`  ${path.join(narrDir, f)}`);
  }
}

function cmdCat({ repoPath, args, c }) {
  const { slug } = resolveRepo(repoPath);
  const dir = storageDir(slug, flag('output-dir', args));
  const narrDir = path.join(dir, 'narratives');
  if (!fs.existsSync(narrDir)) {
    console.log(`${c.red}✗${c.reset} No narratives at ${narrDir}`);
    process.exit(1);
  }
  const from = parseInt(flag('from', args) || '0', 10);
  const to = parseInt(flag('to', args) || '0', 10);
  const outFile = flag('output', args) || flag('o', args);

  const files = fs.readdirSync(narrDir)
    .filter(f => /^pr-\d+\.md$/.test(f))
    .map(f => ({ file: f, num: parseInt(f.match(/^pr-(\d+)\.md$/)[1], 10) }))
    .filter(e => (!from || e.num >= from) && (!to || e.num <= to))
    .sort((a, b) => a.num - b.num);

  if (files.length === 0) {
    console.log(`${c.yellow}No narratives match range${c.reset} (from=${from || 'any'}, to=${to || 'any'})`);
    return;
  }

  const parts = [];
  parts.push(`# PR narratives — ${slug}`);
  parts.push(`range: pr-${files[0].num}..pr-${files[files.length - 1].num} (${files.length} PRs)\n`);
  for (const e of files) {
    parts.push(`\n<!-- ===== ${e.file} ===== -->\n`);
    parts.push(fs.readFileSync(path.join(narrDir, e.file), 'utf8').trimEnd());
  }
  const combined = parts.join('\n') + '\n';

  process.stdout.write(combined);
  if (outFile) {
    fs.writeFileSync(path.resolve(outFile), combined);
    console.error(`\n${c.green}✓${c.reset} Wrote ${files.length} narratives to ${outFile}`);
  }
}

function cmdWhere({ repoPath, args }) {
  const { slug } = resolveRepo(repoPath);
  const dir = storageDir(slug, flag('output-dir', args));
  console.log(dir);
}

function printHelp(c) {
  console.log(`${c.cyan}agx narrate-prs${c.reset} — analyze merged PRs as product/marketing narrative

USAGE
  agx narrate-prs [path]                Run (sync new PRs and analyze). Path defaults to cwd.
  agx narrate-prs ls [path]             Show storage, state, and file counts
  agx narrate-prs where [path]          Print storage directory
  agx narrate-prs cat [path]            Concatenate narratives (--from N --to N, default all; --output file)

FLAGS (run)
  --provider <name>     Provider subcommand to invoke (default: z). Examples: claude|c, codex|x, gemini|g, ollama|o, z
  --model <name>        Model name for the provider (default: sonnet)
  --concurrency <n>     Parallel analyses (default: 5)
  --limit <n>           Cap PRs processed this run
  --since <iso>         Override watermark (e.g. 2026-01-01)
  --force               Ignore state, reprocess everything
  --dry-run             Show what would be processed
  --prompt-file <path>  Use custom analysis prompt
  --output-dir <path>   Override storage location

STORAGE
  ~/.agx/narrate-prs/<owner>__<name>/
    state.json          Processed PR numbers + watermark
    diffs/pr-<n>.diff   PR diff with YAML frontmatter
    narratives/pr-<n>.md Analysis with frontmatter + commits

Designed to be run on a cadence via 'agx schedule'.`);
}

async function handleNarratePrs({ args, ctx }) {
  const { c } = ctx;
  const sub = args[0];

  if (!sub || sub === '-h' || sub === '--help' || sub === 'help') {
    printHelp(c);
    return;
  }

  const knownSubs = new Set(['run', 'ls', 'list', 'where', 'path', 'cat', 'concat']);
  let subcommand, repoPath;
  if (knownSubs.has(sub)) {
    subcommand = sub === 'list' ? 'ls' : (sub === 'path' ? 'where' : (sub === 'concat' ? 'cat' : sub));
    repoPath = args[1] && !args[1].startsWith('-') ? args[1] : null;
  } else {
    subcommand = 'run';
    repoPath = sub && !sub.startsWith('-') ? sub : null;
  }

  const rest = args.slice(repoPath && !knownSubs.has(sub) ? 1 : (knownSubs.has(sub) ? (repoPath ? 2 : 1) : 0));

  try {
    if (subcommand === 'run') await cmdRun({ repoPath, args: rest, c });
    else if (subcommand === 'ls') cmdLs({ repoPath, args: rest, c });
    else if (subcommand === 'where') cmdWhere({ repoPath, args: rest });
    else if (subcommand === 'cat') cmdCat({ repoPath, args: rest, c });
  } catch (err) {
    console.log(`${c.red}✗${c.reset} ${err.message}`);
    process.exit(1);
  }
}

module.exports = { handleNarratePrs };
