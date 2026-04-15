import { runCliResponse } from "@/lib/cli-runner";
import { getLinearIssueContexts } from "@/lib/linear-issues";
import { listLinearRuns } from "@/lib/linear-run-store";
import { writeRecap } from "./storage";

const RECAP_SYSTEM = [
  "You are writing a short recap of a Linear ticket.",
  "Output raw markdown only — no JSON, no fences around the whole response.",
  "Keep it 100–250 words.",
  "Cover: what the ticket is about, what's been attempted (if anything), and what's open.",
  "Write in plain prose. No headings above h3.",
].join("\n");

export async function generateRecap(issueId: string): Promise<void> {
  const [issue] = await getLinearIssueContexts([issueId]);
  if (!issue) {
    throw new Error(`Linear issue not found: ${issueId}`);
  }

  const priorRuns = await listLinearRuns({ issueId, limit: 10 });
  const priorRunLines = priorRuns
    .map(
      (run) =>
        `- ${run.status}: ${run.sessionTitle ?? run.issueTitle} (${run.agentName})`
    )
    .join("\n");

  const prompt = [
    `Ticket: ${issue.identifier} — ${issue.title}`,
    `Status: ${issue.status ?? "unknown"}`,
    issue.assignee ? `Assignee: ${issue.assignee}` : null,
    issue.description ? `\nDescription:\n${issue.description}` : null,
    "",
    priorRunLines ? `Prior sessions:\n${priorRunLines}` : "No prior sessions.",
    "",
    "Write the recap now.",
  ]
    .filter(Boolean)
    .join("\n");

  let output = "";
  await runCliResponse({
    provider: "claude",
    model: null,
    prompt,
    systemContext: RECAP_SYSTEM,
    onDelta: (chunk) => {
      output += chunk;
    },
  });

  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error("Recap generation returned empty output");
  }

  await writeRecap(issueId, trimmed);
}
