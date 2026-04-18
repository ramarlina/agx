import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

// Blockchain domain definitions
const DOMAINS = [
  {
    id: "ethereum",
    name: "Ethereum",
    type: "L1",
    chainId: 1,
    nativeToken: {
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
    },
    rpcUrls: [
      "https://eth.llamarpc.com",
      "https://eth-mainnet.g.alchemy.com/v2/demo",
    ],
    blockExplorer: {
      name: "Etherscan",
      url: "https://etherscan.io",
    },
    agentCoverage: {
      totalAgents: 12,
      activeAgents: 10,
      coverage: 0.95,
      lastUpdated: "2026-02-10T10:30:00Z",
    },
  },
  {
    id: "base",
    name: "Base",
    type: "L2",
    chainId: 8453,
    nativeToken: {
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
    },
    rpcUrls: [
      "https://base.llamarpc.com",
      "https://base-mainnet.g.alchemy.com/v2/demo",
    ],
    blockExplorer: {
      name: "Basescan",
      url: "https://basescan.org",
    },
    agentCoverage: {
      totalAgents: 8,
      activeAgents: 7,
      coverage: 0.87,
      lastUpdated: "2026-02-10T10:25:00Z",
    },
  },
  {
    id: "solana",
    name: "Solana",
    type: "L1",
    chainId: null,
    nativeToken: {
      symbol: "SOL",
      name: "Solana",
      decimals: 9,
    },
    rpcUrls: [
      "https://api.mainnet-beta.solana.com",
      "https://solana-api.projectserum.com",
    ],
    blockExplorer: {
      name: "Solscan",
      url: "https://solscan.io",
    },
    agentCoverage: {
      totalAgents: 9,
      activeAgents: 8,
      coverage: 0.89,
      lastUpdated: "2026-02-10T10:20:00Z",
    },
  },
  {
    id: "arbitrum",
    name: "Arbitrum",
    type: "L2",
    chainId: 42161,
    nativeToken: {
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
    },
    rpcUrls: [
      "https://arbitrum.llamarpc.com",
      "https://arbitrum-mainnet.g.alchemy.com/v2/demo",
    ],
    blockExplorer: {
      name: "Arbiscan",
      url: "https://arbiscan.io",
    },
    agentCoverage: {
      totalAgents: 7,
      activeAgents: 6,
      coverage: 0.85,
      lastUpdated: "2026-02-10T10:15:00Z",
    },
  },
  {
    id: "optimism",
    name: "Optimism",
    type: "L2",
    chainId: 10,
    nativeToken: {
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
    },
    rpcUrls: [
      "https://optimism.llamarpc.com",
      "https://opt-mainnet.g.alchemy.com/v2/demo",
    ],
    blockExplorer: {
      name: "Optimistic Etherscan",
      url: "https://optimistic.etherscan.io",
    },
    agentCoverage: {
      totalAgents: 6,
      activeAgents: 5,
      coverage: 0.83,
      lastUpdated: "2026-02-10T10:10:00Z",
    },
  },
  {
    id: "polygon",
    name: "Polygon",
    type: "L2",
    chainId: 137,
    nativeToken: {
      symbol: "MATIC",
      name: "Polygon",
      decimals: 18,
    },
    rpcUrls: [
      "https://polygon.llamarpc.com",
      "https://polygon-mainnet.g.alchemy.com/v2/demo",
    ],
    blockExplorer: {
      name: "Polygonscan",
      url: "https://polygonscan.com",
    },
    agentCoverage: {
      totalAgents: 11,
      activeAgents: 9,
      coverage: 0.91,
      lastUpdated: "2026-02-10T10:05:00Z",
    },
  },
];

// GET /api/domains/:id - Get a specific domain
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const domain = DOMAINS.find((d) => d.id === id.toLowerCase());
    if (!domain) {
      return NextResponse.json(
        { error: "Domain not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ domain });
  } catch (error) {
    logger.error("Error fetching domain", logger.formatError(error));
    return NextResponse.json(
      { error: "Failed to fetch domain" },
      { status: 500 }
    );
  }
}
