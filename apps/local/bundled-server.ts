import http from "http";
import https from "https";
import path from "path";
import type { IncomingMessage, Server as HttpServer } from "http";
import type { Duplex } from "stream";
import { createTerminalServerBridge } from "./lib/terminal-server";

const PATCHED_SERVER = Symbol.for("agx.terminalBridgePatched");

type PatchedServer = HttpServer & {
  emit: HttpServer["emit"];
  [PATCHED_SERVER]?: boolean;
};

function installTerminalBridge(server: PatchedServer): PatchedServer {
  if (server[PATCHED_SERVER]) {
    return server;
  }

  server[PATCHED_SERVER] = true;
  const terminalBridge = createTerminalServerBridge(server);
  const originalEmit = server.emit.bind(server);

  server.emit = ((event: string, ...args: unknown[]) => {
    if (event === "upgrade") {
      const [req, socket, head] = args as [IncomingMessage, Duplex, Buffer];
      if (terminalBridge.handleUpgrade(req, socket, head)) {
        return true;
      }
    }
    return originalEmit(event, ...args);
  }) as HttpServer["emit"];

  return server;
}

const originalHttpCreateServer = http.createServer.bind(http);
http.createServer = ((...args: Parameters<typeof http.createServer>) =>
  installTerminalBridge(originalHttpCreateServer(...args) as PatchedServer)) as typeof http.createServer;

const originalHttpsCreateServer = https.createServer.bind(https);
https.createServer = ((...args: Parameters<typeof https.createServer>) =>
  installTerminalBridge(originalHttpsCreateServer(...args) as PatchedServer)) as typeof https.createServer;

require(path.join(__dirname, "server.js"));
