import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAllowedOrigins } from "./lib/app-config";

// Rate limit store (in-memory for edge runtime)
// In production, use Redis or the database check
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// Rate limit configs
const RATE_LIMITS: Record<string, { maxRequests: number; windowMs: number }> = {
  "/api/tasks/": { maxRequests: 300, windowMs: 60000 }, // 300/min (task detail/logs)
  "/api/tasks": { maxRequests: 30, windowMs: 60000 }, // 30/min
  "/api/chat": { maxRequests: 100, windowMs: 3600000 }, // 100/hour
  "/api/queue": { maxRequests: 60, windowMs: 60000 }, // 60/min (daemon polling)
  default: { maxRequests: 100, windowMs: 60000 }, // 100/min default
};

// CORS allowed origins (computed once at module load)
const configuredOrigins = getAllowedOrigins();
const extraOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set([...configuredOrigins, ...extraOrigins])];

// Content Security Policy
const BOARD_CONNECT = process.env.NEXT_PUBLIC_AGX_BOARD_URL || "http://localhost:3333";
const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://us-assets.i.posthog.com", // Next.js requires unsafe-eval in dev
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${BOARD_CONNECT} https://www.google-analytics.com https://us.i.posthog.com https://us-assets.i.posthog.com`,
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function getRateLimitConfig(pathname: string): { maxRequests: number; windowMs: number } {
  for (const [path, config] of Object.entries(RATE_LIMITS)) {
    if (path !== "default" && pathname.startsWith(path)) {
      return config;
    }
  }
  return RATE_LIMITS.default;
}

function checkRateLimit(
  identifier: string,
  config: { maxRequests: number; windowMs: number }
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const key = identifier;

  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    // New window
    rateLimitStore.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt: now + config.windowMs };
  }

  if (entry.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt };
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip non-API routes for the rest of the middleware
  if (!pathname.startsWith("/api")) {
    const response = NextResponse.next();
    // Add CSP to all pages
    response.headers.set("Content-Security-Policy", CSP_POLICY);
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "SAMEORIGIN");
    response.headers.set("X-XSS-Protection", "1; mode=block");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    return response;
  }

  // CORS: check origin against configured allowed origins
  const origin = request.headers.get("origin") || "";
  const corsOrigin = allowedOrigins.includes(origin) ? origin : "";

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    const preflight = new NextResponse(null, { status: 204 });
    if (corsOrigin) {
      preflight.headers.set("Access-Control-Allow-Origin", corsOrigin);
      preflight.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      preflight.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      preflight.headers.set("Access-Control-Max-Age", "86400");
    }
    return preflight;
  }

  // Skip rate limiting for task log ingestion/streaming (high frequency)
  if (
    pathname.startsWith("/api/tasks/") &&
    pathname.endsWith("/logs")
  ) {
    const response = NextResponse.next();
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Cache-Control", "no-store");
    if (corsOrigin) response.headers.set("Access-Control-Allow-Origin", corsOrigin);
    return response;
  }

  // Get client identifier (auth token, cookie, or IP)
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";

  const token = "board-local";
  const identifier = `token:${token}`;

  // Rate limiting disabled
  const config = { maxRequests: 999999999, windowMs: 60000 };
  const remaining = 999999999;
  const resetAt = Date.now() + 60000;

  // Add rate limit headers (mocked for compatibility)
  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit", String(config.maxRequests));
  response.headers.set("X-RateLimit-Remaining", String(remaining));
  response.headers.set("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

  // Security headers for API routes
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Cache-Control", "no-store");
  if (corsOrigin) response.headers.set("Access-Control-Allow-Origin", corsOrigin);

  return response;
}

export const config = {
  matcher: [
    // Match all routes except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
