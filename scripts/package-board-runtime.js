#!/usr/bin/env node

const execa = require('execa');
const fs = require('fs');
const path = require('path');

const agxRoot = path.resolve(__dirname, '..');
const localAppRoot = path.join(agxRoot, 'apps', 'local');
const cloudRuntimeDir = path.join(agxRoot, 'cloud-runtime');
const standaloneSrc = path.join(localAppRoot, '.next', 'standalone');
const staticSrc = path.join(localAppRoot, '.next', 'static');
const publicSrc = path.join(localAppRoot, 'public');
const stackTemplateDir = path.join(agxRoot, 'templates', 'stack');
const postgresInitSrc = path.join(localAppRoot, 'docker', 'postgres', 'init');
const postgresInitDest = path.join(stackTemplateDir, 'postgres', 'init');
const CUSTOM_SERVER_ENTRY = 'agx-server.js';
const nodePtyPrebuildsSrc = path.join(agxRoot, 'node_modules', 'node-pty', 'prebuilds');

function ensureExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} not found at ${targetPath}`);
  }
}

function cleanAndPrepare() {
  fs.rmSync(cloudRuntimeDir, { recursive: true, force: true });
  fs.mkdirSync(cloudRuntimeDir, { recursive: true });
}

function copyDir(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

// Files and directories that must never be published in the npm package.
const STRIP_DIRS = new Set(['.agx', 'coverage', '.nyc_output']);
const STRIP_FILES = new Set(['.linear-token.json']);
const STRIP_EXTENSIONS = new Set(['.db', '.db-wal', '.db-shm']);
const SECRET_PATTERNS = [
  /lin_oauth_[a-f0-9]{40,}/,
  /sk-[a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{36,}/,
  /gho_[a-zA-Z0-9]{36,}/,
  /xoxb-[0-9]+-[a-zA-Z0-9]+/,
];

function stripLocalStateDirs(rootDir) {
  if (!fs.existsSync(rootDir)) return;

  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (STRIP_DIRS.has(entry.name)) {
          fs.rmSync(entryPath, { recursive: true, force: true });
          continue;
        }
        stack.push(entryPath);
      } else if (entry.isFile()) {
        const shouldStrip =
          STRIP_FILES.has(entry.name) ||
          STRIP_EXTENSIONS.has(path.extname(entry.name)) ||
          entry.name.startsWith('.env');
        if (shouldStrip) {
          fs.rmSync(entryPath, { force: true });
        }
      }
    }
  }
}

function scanForSecrets(rootDir) {
  const found = [];
  const stack = [rootDir];
  const jsonExtensions = new Set(['.json', '.env', '.ts', '.js', '.txt']);

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        stack.push(entryPath);
      } else if (entry.isFile() && jsonExtensions.has(path.extname(entry.name))) {
        let content;
        try {
          const stat = fs.statSync(entryPath);
          if (stat.size > 512 * 1024) continue; // skip large files
          content = fs.readFileSync(entryPath, 'utf8');
        } catch {
          continue;
        }
        for (const pattern of SECRET_PATTERNS) {
          if (pattern.test(content)) {
            found.push({ file: path.relative(rootDir, entryPath), pattern: pattern.toString() });
          }
        }
      }
    }
  }
  return found;
}

function findPackagedAppDir(rootDir) {
  // Next's standalone output preserves part of the absolute path under `standalone/`,
  // so the app dir isn't stable. Find the directory that contains `server.js` and `package.json`.
  const isStandaloneAppDir = (dir) => {
    try {
      if (!fs.existsSync(path.join(dir, 'server.js'))) return false;
      if (!fs.existsSync(path.join(dir, 'package.json'))) return false;
      if (fs.existsSync(path.join(dir, '.next', 'BUILD_ID'))) return true;
      if (fs.existsSync(path.join(dir, '.next', 'package.json'))) return true;
      return false;
    } catch {
      return false;
    }
  };

  const maxDepth = 8;
  const stack = [{ dir: rootDir, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (isStandaloneAppDir(dir)) return dir;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === '.git') continue;
      stack.push({ dir: path.join(dir, e.name), depth: depth + 1 });
    }
  }
  return null;
}

const GA_MEASUREMENT_ID = "G-DVQQG95LNL";
const GA_SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;

function buildGoogleAnalyticsSnippet(includeLink) {
  const parts = [];
  if (includeLink) {
    parts.push(`<link rel="preload" href="${GA_SCRIPT_URL}" as="script"/>`);
  }
  parts.push(`<script async src="${GA_SCRIPT_URL}"></script>`);
  parts.push(`<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${GA_MEASUREMENT_ID}');
</script>`);
  return `\n${parts.join("\n")}\n`;
}

function injectGoogleAnalyticsIntoHtmlFile(htmlPath) {
  if (!fs.existsSync(htmlPath)) return false;
  const content = fs.readFileSync(htmlPath, "utf8");
  if (content.includes(`<script async src="${GA_SCRIPT_URL}">`)) {
    return false;
  }
  const hasPreload = content.includes(`rel="preload" href="${GA_SCRIPT_URL}" as="script"`);
  const snippet = buildGoogleAnalyticsSnippet(!hasPreload);
  const headIndex = content.indexOf("</head>");
  if (headIndex === -1) {
    return false;
  }
  const updated =
    content.slice(0, headIndex) +
    snippet +
    "</head>" +
    content.slice(headIndex + "</head>".length);
  fs.writeFileSync(htmlPath, updated);
  return true;
}

function injectGoogleAnalyticsIntoAppHtml(appDir) {
  const appHtmlDir = path.join(appDir, ".next", "server", "app");
  if (!fs.existsSync(appHtmlDir)) return false;
  let patched = false;
  for (const entry of fs.readdirSync(appHtmlDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    const fullPath = path.join(appHtmlDir, entry.name);
    if (injectGoogleAnalyticsIntoHtmlFile(fullPath)) {
      patched = true;
    }
  }
  return patched;
}

const useTasksPatches = [
  {
    match: 'let{task:r}=await a.json();return l(e=>e.some(e=>e.id===r.id)?e:[r,...e]),r},[e.realtime]),',
    replace:
      'let{task:r}=await a.json();l(e=>e.some(e=>e.id===r.id)?e:[r,...e]);m().catch(a=>console.error("Failed to refresh tasks:",a));return r},[e.realtime,m]),',
  },
  {
    match:
      'let{task:r}=await a.json();return l(t=>t.map(t=>t.id===e?{...t,...r}:t)),r},[e.realtime]),',
    replace:
      'let{task:r}=await a.json();l(t=>t.map(t=>t.id===e?{...t,...r}:t));m().catch(a=>console.error("Failed to refresh tasks:",a));return r},[e.realtime,m]),',
  },
  {
    match:
      'if(!(await fetch("/api/tasks/".concat(e),{method:"DELETE"})).ok)throw Error("Failed to delete task");l(t=>t.filter(t=>t.id!==e))},[e.realtime]),',
    replace:
      'if(!(await fetch("/api/tasks/".concat(e),{method:"DELETE"})).ok)throw Error("Failed to delete task");l(t=>t.filter(t=>t.id!==e));m().catch(a=>console.error("Failed to refresh tasks:",a))},[e.realtime,m]),',
  },
  {
    match:
      'let{task:a}=await t.json();return l(t=>t.map(t=>t.id===e.taskId?{...t,...a}:t)),a},[e.realtime]);',
    replace:
      'let{task:a}=await t.json();l(t=>t.map(t=>t.id===e.taskId?{...t,...a}:t));m().catch(a=>console.error("Failed to refresh tasks:",a));return a},[e.realtime,m]);',
  },
  {
    match: '},[e.realtime,t]);let k',
    replace:
      '},[e.realtime,t]);(0,r.useEffect)(()=>{if(!e.realtime)return;if("undefined"===typeof EventSource)return;const o=new EventSource("/api/tasks/stream"),d=a=>{try{const n=JSON.parse(a.data);if(!n||"UPDATE"!==n.type||!n.task)return;const t=n.task;return l(r=>{if(!r.some(e=>e.id===t.id))return[t,...r];return r.map(e=>e.id===t.id?t:e)})}catch{}};o.onmessage=d,o.onerror=()=>{};return()=>o.close()},[e.realtime]);let k',
  },
  {
    match: 'c((b)=>{const d=b.some((b)=>b.id===u.id);if(!d)return [u,...b];return b.map((b)=>b.id===u.id?u:b);});',
    replace:
      'c((b)=>{const d=b.some((b)=>b.id===u.id);if(!d)return [u,...b];return b.map((b)=>b.id===u.id?u:b);});n().catch(a=>console.error("Failed to refresh tasks:",a));',
  },
  {
    match: ',[l,m]=(0,d.useState)(null),n=',
    replace:
      ',[l,m]=(0,d.useState)(null),o=(0,d.useEffect)(()=>{if(!a.realtime)return;if("undefined"===typeof EventSource)return;const p=new EventSource("/api/tasks/stream"),q=r=>{if(!r||!r.data)return;let t;try{t=JSON.parse(r.data)}catch(e){return}if(!t||"UPDATE"!==t.type||!t.task)return;const n=t.task;if(!n||!n.id)return;c(u=>{const a=u.some(a=>a.id===n.id);if(!a)return[n,...u];return u.map(a=>a.id===n.id?n:a)})};p.onmessage=q;p.onerror=()=>{};return()=>p.close()},[a.realtime]),n=',
  },
  {
    match:
      'eB=async e=>{try{await completeTaskStage({taskId:e,decision:"blocked",final_result:"Manually blocked by user.",explanation:"Manually blocked by user."})}catch(e){console.error("Failed to stop task",e)}}',
    replace:
      'eB=async e=>{let a=ed.find(a=>a.id===e);R(null);try{var s;await ep({taskId:e}),await eh(),R({type:"success",message:"Cancellation requested for ".concat((null==a?void 0:a.title)||(null==a||null==(s=a.content)?void 0:s.slice(0,30))||e,".")})}catch(t){console.error("Failed to stop task",t);let s=t instanceof Error?t.message:"unknown error";R({type:"error",message:"Unable to stop ".concat((null==a?void 0:a.title)||e,": ").concat(s,".")})}}',
  },
  {
    match: 'onStop:eB,onRetry:eq',
    replace: 'onStop:eB,onRetry:eq,cancellingTaskId:ev',
  },
  {
    match: '{tasks:c,isLoading:e}=(0,j.si)({project:a.slug});',
    replace: '{tasks:c,isLoading:e}=(0,j.si)({project:a.slug,realtime:!0});',
  },
  {
    match: '{tasks:s,isLoading:n}=(0,d.si)({project:r.slug});',
    replace: '{tasks:s,isLoading:n}=(0,d.si)({project:r.slug,realtime:!0});',
  },
  {
    match: '({project:r.slug});',
    replace: '({project:r.slug,realtime:!0});',
  },
  {
    match: '({project:r.slug})',
    replace: '({project:r.slug,realtime:!0})',
  },
];

const dbClientMatch =
  'function n(){return{auth:{getSession:async()=>({data:{session:{access_token:"local-token",refresh_token:"local-refresh",expires_in:3600,user:{id:r.g.id,email:r.g.email,user_metadata:{name:r.g.name,full_name:r.g.name}}}},error:null}),signInWithOAuth:async()=>({error:Error("Auth disabled in AGX Board local mode")}),signOut:async()=>({error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},channel:()=>({on(){return this},subscribe(){return this}}),removeChannel(){}}}';

const dbClientReplacement = `function n(){
  function deriveConfig(name){
    if(name==="tasks-changes"){
      return {
        url:"/api/tasks",
        extract:function(response){
          return response&&Array.isArray(response.tasks)?response.tasks:[];
        },
        pollInterval:2200,
      };
    }
    if(name&&name.startsWith("task-comments-")){
      var id=name.slice(14);
      return {
        url:"/api/tasks/".concat(id,"/comments"),
        extract:function(response){
          return response&&Array.isArray(response.comments)?response.comments:[];
        },
        pollInterval:4000,
      };
    }
    return null;
  }
  function buildSnapshot(items){
    var snapshot=new Map();
    var list=Array.isArray(items)?items:[];
    for(var index=0;index<list.length;index++){
      var item=list[index];
      item&&item.id&&snapshot.set(item.id,item);
    }
    return snapshot;
  }
  function areEqual(a,b){
    try{
      return JSON.stringify(a)===JSON.stringify(b);
    }catch(e){}
    return a===b;
  }
  function createPollingChannel(name){
    var config=deriveConfig(name);
    if(!config){
      return {
        on:function(){return this},
        subscribe:function(){return this},
        unsubscribe:function(){return this},
        stop:function(){return this},
      };
    }
    var handler=function(){};
    var timer=null;
    var primed=false;
    var snapshot=new Map();
    var runPoll=async function(){
      try{
        var response=await fetch(config.url,{cache:"no-store"});
        if(!response.ok)return;
        var payload=await response.json().catch(function(){return null});
        if(!payload)return;
        var items=config.extract(payload);
        if(!Array.isArray(items))return;
        if(!primed){
          primed=true;
          snapshot=buildSnapshot(items);
          return;
        }
        var nextSnapshot=buildSnapshot(items);
        for(var idx=0;idx<items.length;idx++){
          var item=items[idx];
          if(!item||!item.id)continue;
          var previous=snapshot.get(item.id);
          if(!previous){
            handler({eventType:"INSERT",new:item});
          }else if(!areEqual(previous,item)){
            handler({eventType:"UPDATE",new:item,old:previous});
          }
        }
        snapshot.forEach(function(value,key){
          if(!nextSnapshot.has(key)){
            handler({eventType:"DELETE",old:value});
          }
        });
        snapshot=nextSnapshot;
      }catch(e){}
    };
    function startPolling(){
      runPoll();
      if(timer)clearInterval(timer);
      timer=setInterval(runPoll,config.pollInterval||2500);
    }
    function stopPolling(){
      if(timer){
        clearInterval(timer);
        timer=null;
      }
    }
    return {
      on:function(_event,_options,cb){
        if(cb)handler=cb;
        return this;
      },
      subscribe:function(){
        startPolling();
        return this;
      },
      unsubscribe:function(){
        stopPolling();
        return this;
      },
      stop:function(){
        stopPolling();
      },
    };
  }
  return {
    auth:{
      getSession:async()=>({data:{session:{access_token:"local-token",refresh_token:"local-refresh",expires_in:3600,user:{id:r.g.id,email:r.g.email,user_metadata:{name:r.g.name,full_name:r.g.name}}}},error:null}),
      signInWithOAuth:async()=>({error:Error("Auth disabled in AGX Board local mode")}),
      signOut:async()=>({error:null}),
      onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}}},
    },
    channel:function(name){
      return createPollingChannel(name);
    },
    removeChannel:function(channel){
      channel&&channel.unsubscribe&&channel.unsubscribe();
    },
  };
}`;

const dbClientPatch = {
  match: dbClientMatch,
  replace: dbClientReplacement,
};

const bundledRuntimePatches = [...useTasksPatches, dbClientPatch];
const tasksRouteNoisePatch = {
  relativePath: path.join('.next', 'server', 'app', 'api', 'tasks', 'route.js'),
  match:
    'let l=await (0,f.x1)(b,{project:d,status:g||void 0,search:k});return e.NextResponse.json({tasks:l})',
  replace: `let l=await (0,f.x1)(b,{project:d,status:g||void 0,search:k});l=Array.isArray(l)?l.filter(a=>{let b=String(a?.title||"").trim();if(b)return!0;let c=String(a?.content||"").replace(/\\r/g,"").trim();if(!c)return!0;let d=c.toLowerCase();if(!d.startsWith("curl "))return!0;if(!d.includes("/api/tasks?project="))return!0;if(!d.includes("\\n  -h "))return!0;return !(d.includes("-h \\'accept: */*\\'")&&d.includes("-h \\'user-agent:"))}):l;return e.NextResponse.json({tasks:l})`,
};

function patchChunkDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return false;
  let patchedAny = false;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (patchChunkDirectory(entryPath)) {
        patchedAny = true;
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;

    let content = fs.readFileSync(entryPath, 'utf8');
    let updated = content;
    for (const { match, replace } of bundledRuntimePatches) {
      if (updated.includes(replace)) continue;
      if (updated.includes(match)) {
        updated = updated.replace(match, replace);
      }
    }
    if (updated !== content) {
      fs.writeFileSync(entryPath, updated);
      patchedAny = true;
    }
  }

  return patchedAny;
}

function patchBundledFile(baseDir, patch) {
  const targetPath = path.join(baseDir, patch.relativePath);
  if (!fs.existsSync(targetPath)) return false;
  const content = fs.readFileSync(targetPath, 'utf8');
  if (content.includes(patch.replace)) return false;
  if (!content.includes(patch.match)) return false;
  const updated = content.replace(patch.match, patch.replace);
  if (updated === content) return false;
  fs.writeFileSync(targetPath, updated);
  return true;
}

function patchBundledRuntime(appDir) {
  const serverChunkDir = path.join(appDir, '.next', 'server', 'chunks');
  const staticChunkDir = path.join(appDir, '.next', 'static', 'chunks');

  const patchedDirs = [];
  if (patchChunkDirectory(serverChunkDir)) patchedDirs.push('server');
  if (patchChunkDirectory(staticChunkDir)) patchedDirs.push('static');

  if (patchedDirs.length > 0) {
    console.log(`[agx] Patched bundled useTasks hook to refresh after mutations (${patchedDirs.join(', ')})`);
  }

  if (patchBundledFile(appDir, tasksRouteNoisePatch)) {
    console.log('[agx] Patched /api/tasks route to suppress copied curl command dumps in task lists');
  }
}

function sanitizeStandaloneServerConfig(appDir) {
  const serverPath = path.join(appDir, 'server.js');
  if (!fs.existsSync(serverPath)) return false;

  const content = fs.readFileSync(serverPath, 'utf8');
  const sanitized = content
    .replace(/"outputFileTracingRoot":"[^"]+"/g, '"outputFileTracingRoot":"."')
    .replace(/"turbopack":\{"root":"[^"]+"/g, '"turbopack":{"root":"."');

  if (sanitized === content) return false;
  fs.writeFileSync(serverPath, sanitized);
  return true;
}

function sanitizeRequiredServerFiles(appDir) {
  const requiredServerFilesPath = path.join(appDir, '.next', 'required-server-files.json');
  if (!fs.existsSync(requiredServerFilesPath)) return false;

  const raw = fs.readFileSync(requiredServerFilesPath, 'utf8');
  const config = JSON.parse(raw);
  let changed = false;

  if (config?.config?.outputFileTracingRoot && config.config.outputFileTracingRoot !== '.') {
    config.config.outputFileTracingRoot = '.';
    changed = true;
  }

  if (config?.config?.turbopack?.root && config.config.turbopack.root !== '.') {
    config.config.turbopack.root = '.';
    changed = true;
  }

  if (config?.appDir && config.appDir !== '.') {
    config.appDir = '.';
    changed = true;
  }

  if (config?.relativeAppDir && config.relativeAppDir !== '.') {
    config.relativeAppDir = '.';
    changed = true;
  }

  if (!changed) return false;
  fs.writeFileSync(requiredServerFilesPath, `${JSON.stringify(config, null, 2)}\n`);
  return true;
}

async function bundleWorker({ appDir }) {
  const esbuild = require('esbuild');
  const entry = path.join(localAppRoot, 'worker', 'index.ts');
  ensureExists(entry, 'Worker entrypoint');
  const workerOutDir = path.join(appDir, 'worker');
  fs.mkdirSync(workerOutDir, { recursive: true });

  console.log('[agx] Bundling embedded orchestrator worker...');
  await esbuild.build({
    entryPoints: [entry],
    outfile: path.join(workerOutDir, 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node22'],
    sourcemap: false,
    logLevel: 'info',
    plugins: [
      {
        name: 'agx-local-alias-at',
        setup(build) {
          const tryResolve = (basePath) => {
            const candidates = [
              basePath,
              `${basePath}.ts`,
              `${basePath}.tsx`,
              `${basePath}.js`,
              `${basePath}.mjs`,
              `${basePath}.cjs`,
              path.join(basePath, 'index.ts'),
              path.join(basePath, 'index.tsx'),
              path.join(basePath, 'index.js'),
              path.join(basePath, 'index.mjs'),
              path.join(basePath, 'index.cjs'),
            ];
            for (const p of candidates) {
              try {
                if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
              } catch { }
            }
            return null;
          };
          build.onResolve({ filter: /^@\// }, (args) => {
            const rel = args.path.slice(2); // "@/foo" -> "foo"
            const base = path.join(localAppRoot, rel);
            const resolved = tryResolve(base);
            if (!resolved) return { errors: [{ text: `Unable to resolve alias import: ${args.path}` }] };
            return { path: resolved };
          });
        },
      },
    ],
  });
}

async function bundleCustomServer({ appDir }) {
  const esbuild = require('esbuild');
  const entry = path.join(localAppRoot, 'bundled-server.ts');
  ensureExists(entry, 'Bundled server entrypoint');

  console.log('[agx] Bundling standalone board server wrapper...');
  await esbuild.build({
    entryPoints: [entry],
    outfile: path.join(appDir, CUSTOM_SERVER_ENTRY),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node22'],
    sourcemap: false,
    logLevel: 'info',
    external: ['next', 'node-pty'],
  });
}

function patchStandalonePackageScripts(appDir) {
  const appPkgPath = path.join(appDir, 'package.json');
  if (!fs.existsSync(appPkgPath)) {
    return false;
  }

  const appPkg = JSON.parse(fs.readFileSync(appPkgPath, 'utf8'));
  const nextServerCommand = `node ${CUSTOM_SERVER_ENTRY}`;
  appPkg.scripts = appPkg.scripts || {};
  appPkg.scripts.dev = nextServerCommand;
  appPkg.scripts.start = nextServerCommand;
  appPkg.scripts.build = "echo 'standalone build - nothing to build'";
  appPkg.scripts.worker = 'node worker/index.js';
  appPkg.scripts['daemon:worker'] = 'node worker/index.js';
  appPkg.scripts['daemon:orchestrator'] = 'node worker/index.js';
  fs.writeFileSync(appPkgPath, JSON.stringify(appPkg, null, 2) + '\n');
  return true;
}

function copyNodePtyPrebuilds(standaloneRoot, prebuildsSrc = nodePtyPrebuildsSrc) {
  if (!fs.existsSync(prebuildsSrc)) {
    return false;
  }

  const nodePtyDest = path.join(standaloneRoot, 'node_modules', 'node-pty');
  if (!fs.existsSync(nodePtyDest)) {
    return false;
  }

  const prebuildsDest = path.join(nodePtyDest, 'prebuilds');
  fs.mkdirSync(nodePtyDest, { recursive: true });
  fs.cpSync(prebuildsSrc, prebuildsDest, { recursive: true });
  return true;
}

async function main() {
  ensureExists(localAppRoot, 'local board workspace');
  // Optional: keep local stack template schema in sync with the local app.
  if (fs.existsSync(postgresInitSrc)) {
    fs.mkdirSync(postgresInitDest, { recursive: true });
    fs.cpSync(postgresInitSrc, postgresInitDest, { recursive: true });
  }

  console.log('[agx] Building AGX Board runtime from apps/local...');
  // Next can leave stale route artifacts behind in `.next/` (esp. around app router + API routes).
  // Packaging should be deterministic, so always build from a clean `.next/`.
  try {
    fs.rmSync(path.join(localAppRoot, '.next'), { recursive: true, force: true });
  } catch { }
  try {
    fs.rmSync(path.join(localAppRoot, '.next', 'trace'), { force: true });
  } catch { }
  execa.commandSync('npm run build --workspace apps/local', { cwd: agxRoot, stdio: 'inherit' });

  ensureExists(standaloneSrc, 'Next standalone output');
  ensureExists(staticSrc, 'Next static output');

  cleanAndPrepare();

  const standaloneDest = path.join(cloudRuntimeDir, 'standalone');
  copyDir(standaloneSrc, standaloneDest);
  stripLocalStateDirs(standaloneDest);
  if (copyNodePtyPrebuilds(standaloneDest)) {
    console.log('[agx] Copied node-pty prebuilds into standalone runtime');
  }

  const appDir = findPackagedAppDir(standaloneDest);
  if (!appDir) {
    throw new Error(`Unable to locate packaged local app dir under ${standaloneDest}`);
  }

  if (sanitizeStandaloneServerConfig(appDir)) {
    console.log('[agx] Sanitized standalone server config paths');
  }

  if (sanitizeRequiredServerFiles(appDir)) {
    console.log('[agx] Sanitized standalone required-server-files metadata');
  }

  patchBundledRuntime(appDir);
  await bundleCustomServer({ appDir });

  // Next serves assets relative to the app dir (where `server.js` lives), not the standalone root.
  const staticDest = path.join(appDir, '.next', 'static');
  copyDir(staticSrc, staticDest);

  if (injectGoogleAnalyticsIntoAppHtml(appDir)) {
    console.log('[agx] Injected Google Analytics snippet into app HTML');
  }

  if (fs.existsSync(publicSrc)) {
    const publicDest = path.join(appDir, 'public');
    copyDir(publicSrc, publicDest);
  }

  const scriptsSrc = path.join(localAppRoot, 'scripts');
  if (fs.existsSync(scriptsSrc)) {
    const scriptsDest = path.join(appDir, 'scripts');
    copyDir(scriptsSrc, scriptsDest);
  }

  // Patch package.json scripts for standalone context:
  // - "dev"/"start" should use the bundled wrapper entry (not next dev/start)
  // - "worker" should use `node worker/index.js` (not tsx worker/index.ts)
  if (patchStandalonePackageScripts(appDir)) {
    console.log('[agx] Patched package.json scripts for standalone runtime');
  }

  // Ensure the embedded worker exists even when Next standalone output does not include it.
  // The CLI will run it via `node worker/index.js` for bundled runtimes.
  await bundleWorker({ appDir });

  // Final safety check: abort if any secrets slipped through.
  const leaked = scanForSecrets(standaloneDest);
  if (leaked.length > 0) {
    console.error('[agx] ABORTING: secrets detected in packaged runtime:');
    for (const { file, pattern } of leaked) {
      console.error(`  ${file}  (matched ${pattern})`);
    }
    fs.rmSync(cloudRuntimeDir, { recursive: true, force: true });
    process.exit(1);
  }

  console.log(`[agx] Embedded board runtime at ${standaloneDest}`);
}

async function runPackaging() {
  try {
    await main();
  } catch (error) {
    console.error(`[agx] Failed to package board runtime: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  runPackaging();
}

module.exports = {
  CUSTOM_SERVER_ENTRY,
  GA_MEASUREMENT_ID,
  GA_SCRIPT_URL,
  buildGoogleAnalyticsSnippet,
  copyNodePtyPrebuilds,
  injectGoogleAnalyticsIntoHtmlFile,
  injectGoogleAnalyticsIntoAppHtml,
  patchStandalonePackageScripts,
  main,
};
