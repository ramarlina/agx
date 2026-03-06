#!/usr/bin/env bash
set -euo pipefail

echo "==> Packing..."
npm pack
TARBALL=$(ls -t mndrk-agx-*.tgz | head -1)
if [ -z "$TARBALL" ]; then
  echo "==> FAILED: no tarball produced"
  exit 1
fi
trap 'rm -f "$TARBALL"' EXIT
echo "==> Tarball: $TARBALL"

echo "==> Running smoke test in Docker..."
docker run --rm -v "$PWD/$TARBALL:/tmp/pkg.tgz" node:20 bash -c '
  set -e
  mkdir /tmp/smoke && cd /tmp/smoke
  npm init -y > /dev/null 2>&1
  npm install /tmp/pkg.tgz 2>&1 | tail -3

  echo "==> Rebuilding native modules for Linux..."
  cd node_modules/@mndrk/agx/cloud-runtime/standalone
  npm rebuild better-sqlite3 2>&1 | tail -3
  cd /tmp/smoke

  echo "==> Starting board..."
  BOARD_DIR=node_modules/@mndrk/agx/cloud-runtime/standalone

  export PORT=41741
  export HOSTNAME=0.0.0.0
  export AGX_BOARD_DISABLE_AUTH=1
  export SQLITE_DB_PATH=/tmp/agx-board.db
  export AGX_DB_PATH=/tmp/agx.db
  export SQLITE_QUEUE_PATH=/tmp/agx-queue.db
  node "$BOARD_DIR/server.js" &
  SERVER_PID=$!

  for i in $(seq 1 15); do
    if node -e "require(\"http\").get(\"http://localhost:41741\",r=>{process.exit(r.statusCode<400?0:1)}).on(\"error\",()=>process.exit(1))" 2>/dev/null; then
      echo "==> Server is up"
      break
    fi
    sleep 2
    if [ "$i" -eq 15 ]; then
      echo "==> FAILED: Board not reachable after 30s"
      kill $SERVER_PID 2>/dev/null || true
      exit 1
    fi
  done

  echo "==> Testing project creation..."
  PROJECT_STATUS=$(node -e "
    const http = require(\"http\");
    const data = JSON.stringify({ name: \"Smoke Test Project\" });
    const req = http.request({ hostname: \"localhost\", port: 41741, path: \"/api/projects\", method: \"POST\", headers: { \"Content-Type\": \"application/json\", \"Content-Length\": data.length } }, (res) => {
      let body = \"\";
      res.on(\"data\", (c) => body += c);
      res.on(\"end\", () => {
        console.log(res.statusCode);
        if (res.statusCode >= 400) { console.error(\"Response:\", body); }
      });
    });
    req.on(\"error\", (e) => { console.error(e); process.exit(1); });
    req.write(data);
    req.end();
  " 2>&1)
  PROJECT_CODE=$(echo "$PROJECT_STATUS" | head -1)
  if [ "$PROJECT_CODE" -ge 400 ] 2>/dev/null; then
    echo "==> FAILED: Project creation returned $PROJECT_CODE"
    echo "$PROJECT_STATUS"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
  fi
  echo "==> Project creation passed (status $PROJECT_CODE)"

  echo "==> Smoke test passed"
  kill $SERVER_PID 2>/dev/null || true
  exit 0
'
