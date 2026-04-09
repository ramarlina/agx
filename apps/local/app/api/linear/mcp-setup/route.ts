import { NextRequest, NextResponse } from "next/server";
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
  hasLinearMcp: (config: Record<string, unknown>) => boolean;
  addLinearMcp: (config: Record<string, unknown>) => Record<string, unknown>;
  removeLinearMcp: (config: Record<string, unknown>) => Record<string, unknown>;
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
        hasLinearMcp: (config) => {
          const servers = config.mcpServers as Record<string, unknown> | undefined;
          return !!servers?.linear;
        },
        addLinearMcp: (config) => {
          const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
          servers.linear = { type: "url", url: "https://mcp.linear.app/sse" };
          return { ...config, mcpServers: servers };
        },
        removeLinearMcp: (config) => {
          const servers = config.mcpServers as Record<string, unknown> | undefined;
          if (servers?.linear) delete servers.linear;
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
        hasLinearMcp: (config) => {
          const servers = config.mcpServers as Record<string, unknown> | undefined;
          return !!servers?.linear;
        },
        addLinearMcp: (config) => {
          const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
          servers.linear = { type: "url", url: "https://mcp.linear.app/sse" };
          return { ...config, mcpServers: servers };
        },
        removeLinearMcp: (config) => {
          const servers = config.mcpServers as Record<string, unknown> | undefined;
          if (servers?.linear) delete servers.linear;
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
        hasLinearMcp: (config) => {
          const servers = config.mcp_servers as Record<string, unknown> | undefined;
          return !!servers?.linear;
        },
        addLinearMcp: (config) => {
          const servers = (config.mcp_servers ?? {}) as Record<string, unknown>;
          servers.linear = { url: "https://mcp.linear.app/mcp" };
          return { ...config, mcp_servers: servers };
        },
        removeLinearMcp: (config) => {
          const servers = config.mcp_servers as Record<string, unknown> | undefined;
          if (servers?.linear) delete servers.linear;
          return config;
        },
      };
    }

    default:
      return null;
  }
}

// GET: Check MCP config status for each CLI
export async function GET() {
  const results: Record<string, boolean> = {};

  for (const cli of ["claude", "codex", "gemini"]) {
    const info = getCliConfigInfo(cli);
    if (!info) {
      results[cli] = false;
      continue;
    }
    try {
      const config = info.read();
      results[cli] = info.hasLinearMcp(config);
    } catch {
      results[cli] = false;
    }
  }

  return NextResponse.json({ configured: results });
}

// POST: Configure MCP for a specific CLI
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { cli: string };
  const { cli } = body;

  if (!cli) {
    return NextResponse.json({ error: "Missing cli parameter" }, { status: 400 });
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
    const updated = info.addLinearMcp(config);
    info.write(updated);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to write config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: Remove Linear MCP config from a specific CLI
export async function DELETE(request: NextRequest) {
  const body = (await request.json()) as { cli: string };
  const { cli } = body;

  const info = getCliConfigInfo(cli);
  if (!info) {
    return NextResponse.json({ error: `Unsupported CLI: ${cli}` }, { status: 400 });
  }

  try {
    const config = info.read();
    const updated = info.removeLinearMcp(config);
    info.write(updated);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
