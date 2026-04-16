import "@/lib/tracker"; // Ensure adapters are registered

import { getAdapter, listAdapterTypes } from "@/lib/tracker/registry";
import type { TrackerAdapter } from "@/lib/tracker/tracker-adapter";

export function resolveAdapter(trackerType: string | null): TrackerAdapter {
  if (!trackerType) {
    throw new Error(`Missing tracker type. Available: ${listAdapterTypes().join(", ")}`);
  }
  return getAdapter(trackerType);
}

export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export function notFound(message: string): Response {
  return Response.json({ error: message }, { status: 404 });
}

export function unauthorized(message = "Not connected"): Response {
  return Response.json({ error: message }, { status: 401 });
}

export function serverError(message: string): Response {
  return Response.json({ error: message }, { status: 500 });
}