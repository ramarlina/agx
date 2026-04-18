import { listCachedTrackerItems } from "./tracker/tracker-item-store";
import { findAgxTaskByIdentifier } from "./task-identifier-store";
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
 * Resolver for agx task identifiers (e.g. "TSK-42", "AGX-7").
 *
 * Looks up the `tasks.identifier` column, which is populated on creation when
 * the parent project has an `identifier_prefix` set. Matches are
 * case-insensitive. The returned `targetId` is the identifier string itself
 * (mirroring Linear's resolver), so downstream `pr_links` store a stable
 * user-visible key.
 */
export const agxTaskResolver: TrackerResolver = async (id) => {
  const needle = id.toUpperCase();
  const hit = await findAgxTaskByIdentifier(needle);
  if (!hit) return null;
  return { targetType: "agx_task", targetId: needle };
};

/**
 * Default resolver list used by the sync orchestrator. Add/remove entries
 * here as trackers gain identifier support.
 */
export const defaultResolvers: TrackerResolver[] = [
  linearIssueResolver,
  agxTaskResolver,
];
