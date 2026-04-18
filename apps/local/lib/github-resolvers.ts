import { listCachedTrackerItems } from "./tracker/tracker-item-store";
import type { TrackerResolver } from "./github-link-resolver";

/**
 * Resolver for Linear issue identifiers like "AGX-42" (or any tracker using the
 * generic tracker-item cache). Matches the cached item whose `identifier`
 * exactly equals the input.
 */
export const linearIssueResolver: TrackerResolver = async (id) => {
  const needle = id.toUpperCase();
  const result = await listCachedTrackerItems({ search: needle, limit: 20 });
  const hit = result.issues.find((i) => i.identifier.toUpperCase() === needle);
  if (!hit) return null;
  return { targetType: "linear_issue", targetId: hit.identifier };
};

/**
 * Resolver for agx task identifiers.
 *
 * BLOCKER: agx tasks currently have no stable `PREFIX-N` identifier column in
 * the `tasks` table — they're keyed by UUID + mutable slug. Until a schema
 * migration adds a stable identifier, this resolver always returns null.
 *
 * To unblock:
 *   1. Add `identifier TEXT UNIQUE` to the `tasks` table (e.g. `AGX-123`).
 *   2. Populate it on task creation with a monotonic per-project counter.
 *   3. Replace the body of this resolver with an exact lookup.
 */
export const agxTaskResolver: TrackerResolver = async (_id) => {
  return null;
};

/**
 * Default resolver list used by the sync orchestrator. Add/remove entries
 * here as trackers gain identifier support.
 */
export const defaultResolvers: TrackerResolver[] = [
  linearIssueResolver,
  agxTaskResolver,
];
