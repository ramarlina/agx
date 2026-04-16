import "server-only";

import {
  startScriptedLinearSession,
  type ScriptedLinearSessionIssueInput,
  type StartedScriptedLinearSession,
} from "@/lib/linear-scripted-session";

export interface ScriptedTrackerSessionIssueInput {
  id: string;
  identifier: string;
  title: string;
  status: string;
  assignee?: string | null;
}

export interface StartScriptedTrackerSessionInput {
  trackerType: string;
  projectId?: string | null;
  projectSlug?: string | null;
  issue: ScriptedTrackerSessionIssueInput;
  agentId: string;
  scriptName?: string | null;
  scriptPrompt?: string | null;
}

/**
 * Start a scripted tracker session.
 * Currently delegates to the Linear scripted session.
 * When additional trackers are added, this will dispatch based on trackerType.
 */
export async function startScriptedTrackerSession(
  input: StartScriptedTrackerSessionInput
): Promise<StartedScriptedLinearSession> {
  switch (input.trackerType) {
    case "linear":
    default:
      return startScriptedLinearSession({
        projectId: input.projectId,
        projectSlug: input.projectSlug,
        issue: input.issue as ScriptedLinearSessionIssueInput,
        agentId: input.agentId,
        scriptName: input.scriptName,
        scriptPrompt: input.scriptPrompt,
      });
  }
}