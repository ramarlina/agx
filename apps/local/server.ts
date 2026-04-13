import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { createTerminalServerBridge } from "./lib/terminal-server";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "41741", 10);
const host = "127.0.0.1";

const app = next({ dev, port, hostname: host });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const terminalBridge = createTerminalServerBridge(server);

  server.on("upgrade", (req, socket, head) => {
    if (terminalBridge.handleUpgrade(req, socket, head)) return;
    // Let Next.js handle its own WebSocket upgrades (HMR, etc.)
  });

  server.listen(port, host, () => {
    console.log(`> AGX Local ready on http://${host}:${port}`);
  });

  // Cleanup on exit
  const cleanup = () => {
    terminalBridge.close();
    process.exit();
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
});
