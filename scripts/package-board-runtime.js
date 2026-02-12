#!/usr/bin/env node

const execa = require('execa');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const agxRoot = path.resolve(__dirname, '..');
const cloudRoot = path.resolve(agxRoot, '..', 'agx-cloud');
const cloudRuntimeDir = path.join(agxRoot, 'cloud-runtime');
const standaloneSrc = path.join(cloudRoot, '.next', 'standalone');
const staticSrc = path.join(cloudRoot, '.next', 'static');
const publicSrc = path.join(cloudRoot, 'public');
const stackTemplateDir = path.join(agxRoot, 'templates', 'stack');
const postgresInitSrc = path.join(cloudRoot, 'docker', 'postgres', 'init');
const postgresInitDest = path.join(stackTemplateDir, 'postgres', 'init');

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

function patchBundledRuntime(appDir) {
  const serverChunkDir = path.join(appDir, '.next', 'server', 'chunks');
  const staticChunkDir = path.join(appDir, '.next', 'static', 'chunks');

  const patchedDirs = [];
  if (patchChunkDirectory(serverChunkDir)) patchedDirs.push('server');
  if (patchChunkDirectory(staticChunkDir)) patchedDirs.push('static');

  if (patchedDirs.length > 0) {
    console.log(`[agx] Patched bundled useTasks hook to refresh after mutations (${patchedDirs.join(', ')})`);
  }
}

async function bundleWorker({ appDir }) {
  const entry = path.join(cloudRoot, 'worker', 'index.ts');
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
    target: ['node18'],
    sourcemap: false,
    logLevel: 'info',
    plugins: [
      {
        name: 'agx-cloud-alias-at',
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
                if (fs.existsSync(p)) return p;
              } catch { }
            }
            return null;
          };
          build.onResolve({ filter: /^@\// }, (args) => {
            const rel = args.path.slice(2); // "@/foo" -> "foo"
            const base = path.join(cloudRoot, rel);
            const resolved = tryResolve(base);
            if (!resolved) return { errors: [{ text: `Unable to resolve alias import: ${args.path}` }] };
            return { path: resolved };
          });
        },
      },
    ],
  });
}

async function main() {
  ensureExists(cloudRoot, 'agx-cloud repository');
  // Optional: keep local stack template schema in sync with agx-cloud.
  if (fs.existsSync(postgresInitSrc)) {
    fs.mkdirSync(postgresInitDest, { recursive: true });
    fs.cpSync(postgresInitSrc, postgresInitDest, { recursive: true });
  }

  console.log('[agx] Building AGX Board runtime from agx-cloud...');
  // Next can leave stale route artifacts behind in `.next/` (esp. around app router + API routes).
  // Packaging should be deterministic, so always build from a clean `.next/`.
  try {
    fs.rmSync(path.join(cloudRoot, '.next'), { recursive: true, force: true });
  } catch { }
  try {
    fs.rmSync(path.join(cloudRoot, '.next', 'trace'), { force: true });
  } catch { }
  execa.commandSync('npm run build', { cwd: cloudRoot, stdio: 'inherit' });

  ensureExists(standaloneSrc, 'Next standalone output');
  ensureExists(staticSrc, 'Next static output');

  cleanAndPrepare();

  const standaloneDest = path.join(cloudRuntimeDir, 'standalone');
  copyDir(standaloneSrc, standaloneDest);

  const appDir = findPackagedAppDir(standaloneDest);
  if (!appDir) {
    throw new Error(`Unable to locate packaged agx-cloud app dir under ${standaloneDest}`);
  }

  patchBundledRuntime(appDir);

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

  const scriptsSrc = path.join(cloudRoot, 'scripts');
  if (fs.existsSync(scriptsSrc)) {
    const scriptsDest = path.join(appDir, 'scripts');
    copyDir(scriptsSrc, scriptsDest);
  }

  // Patch package.json scripts for standalone context:
  // - "dev"/"start" should use `node server.js` (not next dev/start)
  // - "worker" should use `node worker/index.js` (not tsx worker/index.ts)
  const appPkgPath = path.join(appDir, 'package.json');
  if (fs.existsSync(appPkgPath)) {
    const appPkg = JSON.parse(fs.readFileSync(appPkgPath, 'utf8'));
    appPkg.scripts = appPkg.scripts || {};
    appPkg.scripts.dev = 'node server.js';
    appPkg.scripts.start = 'node server.js';
    appPkg.scripts.build = "echo 'standalone build - nothing to build'";
    appPkg.scripts.worker = 'node worker/index.js';
    appPkg.scripts['daemon:worker'] = 'node worker/index.js';
    appPkg.scripts['daemon:temporal'] = 'node worker/index.js';
    fs.writeFileSync(appPkgPath, JSON.stringify(appPkg, null, 2) + '\n');
    console.log('[agx] Patched package.json scripts for standalone runtime');
  }

  // Ensure the embedded worker exists even when Next standalone output does not include it.
  // The CLI will run it via `node worker/index.js` for bundled runtimes.
  await bundleWorker({ appDir });

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
  GA_MEASUREMENT_ID,
  GA_SCRIPT_URL,
  buildGoogleAnalyticsSnippet,
  injectGoogleAnalyticsIntoHtmlFile,
  injectGoogleAnalyticsIntoAppHtml,
  main,
};
