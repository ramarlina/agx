import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import {
  createSession,
  getSession,
  destroySession,
  resizeSession,
  destroyAll,
  subscribeToSession,
} from "./lib/pty-manager";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "41741", 10);
const heartbeatIntervalMs = parsePositiveInt(
  process.env.AGX_TERMINAL_HEARTBEAT_MS,
  30_000,
);

type HeartbeatWebSocket = WebSocket & { isAlive?: boolean };

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const app = next({ dev, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });
  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      const heartbeatClient = client as HeartbeatWebSocket;

      if (heartbeatClient.isAlive === false) {
        client.terminate();
        continue;
      }

      heartbeatClient.isAlive = false;
      if (client.readyState === WebSocket.OPEN) {
        client.ping();
      }
    }
  }, heartbeatIntervalMs);
  heartbeatInterval.unref?.();

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url!, true);

    if (pathname === "/ws/terminal") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
    // Let Next.js handle its own WebSocket upgrades (HMR, etc.)
  });

  wss.on("connection", (ws: WebSocket) => {
    const heartbeatSocket = ws as HeartbeatWebSocket;
    heartbeatSocket.isAlive = true;
    let sessionId: string | null = null;
    let unsubscribe: (() => void) | null = null;

    ws.on("pong", () => {
      heartbeatSocket.isAlive = true;
    });

    ws.on("message", (raw) => {
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case "create": {
          const id = msg.id as string;
          const cwd = (msg.cwd as string) || undefined;

          try {
            // Reuse existing session or create new one
            let session = getSession(id);
            if (!session) {
              session = createSession(id, cwd);
            }
            sessionId = id;

            unsubscribe?.();
            unsubscribe = subscribeToSession(id, {
              onData(data: string) {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "data", data }));
                }
              },
              onExit({ exitCode }) {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "exit", exitCode }));
                }
              },
            });

            ws.send(JSON.stringify({ type: "ready", id, backend: session.backend }));
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Failed to start terminal session";
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "error", message }));
              ws.close(1011, "terminal-create-failed");
            }
          }
          break;
        }

        case "data": {
          if (!sessionId) return;
          const session = getSession(sessionId);
          session?.process.write(msg.data as string);
          break;
        }

        case "resize": {
          if (!sessionId) return;
          const cols = msg.cols as number;
          const rows = msg.rows as number;
          if (cols > 0 && rows > 0) {
            resizeSession(sessionId, cols, rows);
          }
          break;
        }

        case "destroy": {
          const id = (msg.id as string) || sessionId;
          if (id) {
            if (id === sessionId) {
              unsubscribe?.();
              unsubscribe = null;
              sessionId = null;
            }
            destroySession(id);
          }
          break;
        }

        case "destroy-all": {
          unsubscribe?.();
          unsubscribe = null;
          sessionId = null;
          destroyAll();
          break;
        }

        default: {
          break;
        }
      }
    });

    ws.on("close", () => {
      unsubscribe?.();
      unsubscribe = null;
      // Don't destroy session on disconnect — allow reconnect
    });
  });

  server.listen(port, () => {
    console.log(`> AGX Local ready on http://localhost:${port}`);
  });

  // Cleanup on exit
  const cleanup = () => {
    clearInterval(heartbeatInterval);
    destroyAll();
    process.exit();
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
});
