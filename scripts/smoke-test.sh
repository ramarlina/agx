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
  cd node_modules/@mndrk/agx/cloud-runtime/standalone/Projects/Agents/agx-cloud
  npm rebuild better-sqlite3 2>&1 | tail -3
  cd /tmp/smoke

  echo "==> Starting board..."
  BOARD_DIR=node_modules/@mndrk/agx/cloud-runtime/standalone/Projects/Agents/agx-cloud

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
      echo "==> Smoke test passed"
      kill $SERVER_PID 2>/dev/null || true
      exit 0
    fi
    sleep 2
  done

  echo "==> FAILED: Board not reachable after 30s"
  kill $SERVER_PID 2>/dev/null || true
  exit 1
'
