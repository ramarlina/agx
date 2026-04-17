import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker"; // Ensure adapters are registered
import { resolveAdapter, badRequest } from "@/lib/tracker/route-helpers";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "@iarna/toml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CliConfigInfo {
  path: string;
  read: () => Record<string, unknown>;
  write: (config: Record<string, unknown>) => void;
  hasMcpServer: (config: Record<string, unknown>, serverKey: string) => boolean;
  addMcpServer: (config: Record<string, unknown>, serverKey: string, serverValue: unknown) => Record<string, unknown>;
  removeMcpServer: (config: Record<string, unknown>, serverKey: string) => Record<string, unknown>;
}

function getCliConfigInfo(cli: string): CliConfigInfo | null {
  const home = homedir();

  switch (cli) {
    case "claude": {
      const configPath = path.join(home, ".claude", "settings.json");
      return {
        path: configPath,
        read: () => {
          if (!existsSync(configPath)) return {};
          return JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
        },
        write: (config) => {
          writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
        },
        hasMcpServer: (config, serverKey) => {
          const servers = config.mcpServers as Record<string, unknown> | undefined;
          return !!servers?.[serverKey];
        },
        addMcpServer: (config, serverKey, serverValue) => {
          const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
          servers[serverKey] = serverValue;
          return { ...config, mcpServers: servers };
        },
        removeMcpServer: (config, serverKey) => {
          const servers = config.mcpServers as Record<string, unknown> | undefined;
          if (servers?.[serverKey]) delete servers[serverKey];
          return config;
        },
      };
    }

    case "gemini": {
      const configPath = path.join(home, ".gemini", "settings.json");
      return {
        path: configPath,
        read: () => {
          if (!existsSync(configPath)) return {};
          return JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
        },
        write: (config) => {
          writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
        },
        hasMcpServer: (config, serverKey) => {
          const servers = config.mcpServers as Record<string, unknown> | undefined;
          return !!servers?.[serverKey];
        },
        addMcpServer: (config, serverKey, serverValue) => {
          const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
          servers[serverKey] = serverValue;
          return { ...config, mcpServers: servers };
        },
        removeMcpServer: (config, serverKey) => {
          const servers = config.mcpServers as Record<string, unknown> | undefined;
          if (servers?.[serverKey]) delete servers[serverKey];
          return config;
        },
      };
    }

    case "codex": {
      const configPath = path.join(home, ".codex", "config.toml");
      return {
        path: configPath,
        read: () => {
          if (!existsSync(configPath)) return {};
          return parseToml(readFileSync(configPath, "utf8")) as Record<string, unknown>;
        },
        write: (config) => {
          writeFileSync(configPath, stringifyToml(config as Parameters<typeof stringifyToml>[0]) + "\n");
        },
        hasMcpServer: (config, serverKey) => {
          const servers = config.mcp_servers as Record<string, unknown> | undefined;
          return !!servers?.[serverKey];
        },
        addMcpServer: (config, serverKey, serverValue) => {
          const servers = (config.mcp_servers ?? {}) as Record<string, unknown>;
          servers[serverKey] = serverValue;
          return { ...config, mcp_servers: servers };
        },
        removeMcpServer: (config, serverKey) => {
          const servers = config.mcp_servers as Record<string, unknown> | undefined;
          if (servers?.[serverKey]) delete servers[serverKey];
          return config;
        },
      };
    }

    default:
      return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string }> }
) {
  const { tracker } = await params;
  const adapter = resolveAdapter(tracker);
  const mcpConfig = adapter.getMcpConfig?.(req.nextUrl.searchParams.get("projectId") ?? "");

  if (!mcpConfig) {
    return NextResponse.json({ configured: {} });
  }

  const serverKey = mcpConfig.name;
  const results: Record<string, boolean> = {};

  for (const cli of ["claude", "codex", "gemini"]) {
    const info = getCliConfigInfo(cli);
    if (!info) {
      results[cli] = false;
      continue;
    }
    try {
      const config = info.read();
      results[cli] = info.hasMcpServer(config, serverKey);
    } catch {
      results[cli] = false;
    }
  }

  return NextResponse.json({ configured: results });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string }> }
) {
  const { tracker } = await params;
  const body = (await req.json()) as { cli: string };
  const { cli } = body;

  if (!cli) {
    return NextResponse.json({ error: "Missing cli parameter" }, { status: 400 });
  }

  const adapter = resolveAdapter(tracker);
  const mcpConfig = adapter.getMcpConfig?.(req.nextUrl.searchParams.get("projectId") ?? "");

  if (!mcpConfig) {
    return badRequest("Tracker does not support MCP configuration");
  }

  const info = getCliConfigInfo(cli);
  if (!info) {
    return NextResponse.json(
      { error: `MCP configuration not supported for ${cli} yet` },
      { status: 400 }
    );
  }

  try {
    const config = info.read();
    const serverKey = mcpConfig.name;

    let serverValue: unknown;
    if (mcpConfig.url) {
      if (cli === "codex") {
        serverValue = {
          url: mcpConfig.url,
          ...(mcpConfig.headers && Object.keys(mcpConfig.headers).length > 0 ? { headers: mcpConfig.headers } : {}),
        };
      } else {
        serverValue = {
          type: "url",
          url: mcpConfig.url,
          ...(mcpConfig.headers && Object.keys(mcpConfig.headers).length > 0 ? { headers: mcpConfig.headers } : {}),
        };
      }
    } else {
      serverValue = {
        command: mcpConfig.command,
        ...(mcpConfig.args ? { args: mcpConfig.args } : {}),
        ...(mcpConfig.env && Object.keys(mcpConfig.env).length > 0 ? { env: mcpConfig.env } : {}),
      };
    }

    const updated = info.addMcpServer(config, serverKey, serverValue);
    info.write(updated);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to write config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string }> }
) {
  const { tracker } = await params;
  const body = (await req.json()) as { cli: string };
  const { cli } = body;

  const adapter = resolveAdapter(tracker);
  const mcpConfig = adapter.getMcpConfig?.(req.nextUrl.searchParams.get("projectId") ?? "");

  if (!mcpConfig) {
    return badRequest("Tracker does not support MCP configuration");
  }

  const info = getCliConfigInfo(cli);
  if (!info) {
    return NextResponse.json({ error: `Unsupported CLI: ${cli}` }, { status: 400 });
  }

  try {
    const config = info.read();
    const updated = info.removeMcpServer(config, mcpConfig.name);
    info.write(updated);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}