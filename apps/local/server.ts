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
} from "./lib/pty-manager";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "41741", 10);

const app = next({ dev, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

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
    let sessionId: string | null = null;

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

          // Reuse existing session or create new one
          let session = getSession(id);
          if (!session) {
            session = createSession(id, cwd);
          }
          sessionId = id;

          session.process.onData((data: string) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "data", data }));
            }
          });

          session.process.onExit(({ exitCode }) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({ type: "exit", exitCode }),
              );
            }
          });

          ws.send(JSON.stringify({ type: "ready", id }));
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
          if (sessionId) {
            destroySession(sessionId);
            sessionId = null;
          }
          break;
        }
      }
    });

    ws.on("close", () => {
      // Don't destroy session on disconnect — allow reconnect
    });
  });

  server.listen(port, () => {
    console.log(`> AGX Local ready on http://localhost:${port}`);
  });

  // Cleanup on exit
  const cleanup = () => {
    destroyAll();
    process.exit();
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
});
