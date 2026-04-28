import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { createTerminalServerBridge } from "./lib/terminal-server";
import { ensureFreshRepoIndex } from "./lib/git-repo-index";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "41741", 10);
const host = "127.0.0.1";

const app = next({ dev, port, hostname: host });

app.prepare().then(() => {
  const handle = app.getRequestHandler();
  const handleUpgrade = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const terminalBridge = createTerminalServerBridge(server);

  server.on("upgrade", (req, socket, head) => {
    if (terminalBridge.handleUpgrade(req, socket, head)) return;
    void handleUpgrade(req, socket, head).catch((error) => {
      console.error("Failed to handle Next.js websocket upgrade:", error);
      socket.destroy();
    });
  });

  server.listen(port, host, () => {
    console.log(`> AGX Local ready on http://${host}:${port}`);
  });

  // Kick off background repo index refresh (non-blocking)
  setImmediate(() => {
    ensureFreshRepoIndex()
      .then((res) => {
        console.log(
          `> Repo index ensure-fresh: ${res.scanning ? "scan started" : "fresh"}`,
        );
      })
      .catch((err) => {
        console.error("Repo index ensure-fresh failed:", err);
      });
  });

  // Cleanup on exit
  const cleanup = () => {
    terminalBridge.close();
    process.exit();
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
});
