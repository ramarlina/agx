/* eslint-disable no-console */
'use strict';

function createCloudPromptHelpers(env) {
  const { path, truncateForPrompt, VERIFY_PROMPT_MAX_CHARS } = env || {};

  function resolveAggregatorModel(task) {
    const explicitAggregatorModel = typeof task?.engine_model === 'string' && task.engine_model.trim()
      ? task.engine_model.trim()
      : (typeof task?.aggregator_model === 'string' && task.aggregator_model.trim() ? task.aggregator_model.trim() : null);
    if (explicitAggregatorModel) return explicitAggregatorModel;

    if (typeof task?.model === 'string' && task.model.trim()) {
      return task.model.trim();
    }
    return null;
  }

  /**
   * Build the common aggregator prompt structure.
   * @param {object} params
   * @param {string} params.role - e.g. 'single-agent' or 'swarm'
   * @param {string} params.taskId
   * @param {object} params.task
   * @param {string} params.stagePrompt
   * @param {string} params.stageRequirement
   * @param {string|null} params.runPath - local run folder containing artifacts (when available)
   * @param {string[]} params.fileRefs - absolute file refs detected from agent output/logs
   * @returns {string}
   */
  function buildAggregatorPrompt({ role, taskId, task, stagePrompt, stageRequirement, runPath, fileRefs }) {
    const taskComments = task?.comments || [];
    const refs = Array.isArray(fileRefs) ? fileRefs.filter(Boolean).slice(0, 20) : [];
    const refsBlock = refs.length ? refs.map((p) => `- ${p}`).join('\n') : '- (none detected)';
    const runRoot = runPath ? String(runPath) : '';
    const runFiles = runRoot
      ? [
        `- ${path.join(runRoot, 'output.md')} (agent output)`,
        `- ${path.join(runRoot, 'prompt.md')} (prompts captured during the run)`,
        `- ${path.join(runRoot, 'decision.json')} (final decision payload)`,
        `- ${path.join(runRoot, 'events.ndjson')} (engine trace + run events)`,
        `- ${path.join(runRoot, 'artifacts')} (additional artifacts, if any)`,
      ].join('\n')
      : [
        '- output.md (agent output)',
        '- prompt.md (prompts captured during the run)',
        '- decision.json (final decision payload)',
        '- events.ndjson (engine trace + run events)',
        '- artifacts/ (additional artifacts, if any)',
      ].join('\n');

    return `You are the decision aggregator for a ${role} run.

Task ID: ${taskId}
Title: ${task?.title || taskId}
Stage: ${task?.stage || 'unknown'}

User Request: 
"""
${task?.title}
${task?.content}
---
Task Thread:
${taskComments.map(c => `${c.author}: ${c.content}`).join('\n')}
"""

Stage Objective: ${stagePrompt}
Stage Completion Requirement: ${stageRequirement}

Local run artifacts folder: ${runRoot || '(not available)'}
Key run files:
${runFiles}

Relevant files referenced during execution (detected from output/logs):
${refsBlock}

Decide if the task is done. If not, provide the next instruction for another iteration.
Only set "done": true when the Stage Completion Requirement is satisfied.

You may think through your analysis first, but you MUST end your response with valid JSON.

Output contract (strict):
- You may include thinking/reasoning at the start of your response
- Your response MUST end with exactly one raw JSON object
- Do not use markdown/code fences/backticks around the JSON
- Do not add commentary after the JSON
- Use double-quoted keys and strings
- Keep newlines escaped inside strings
- If "done" is false, "next_prompt" must be a non-empty actionable instruction

The final JSON in your response must have this exact shape:
{
  "done": false,
  "decision": "done|blocked|not_done|failed",
  "explanation": "clear explanation of the decision",
  "final_result": "final result if done, empty string otherwise",
  "next_prompt": "specific actionable instruction for next iteration",
  "summary": "brief summary of current state"
}

If uncertain, still return valid JSON with decision "failed" and explain why in "explanation".
`;
  }

  function truncateForPromptLocal(text, maxChars) {
    const value = String(text || '');
    const cap = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 6000;
    if (value.length <= cap) return value;
    return `${value.slice(0, cap)}\n[truncated]`;
  }

  function buildExecuteIterationPrompt(nextPrompt, iteration) {
    const instruction = typeof nextPrompt === 'string' && nextPrompt.trim()
      ? nextPrompt.trim()
      : 'Pick the next concrete step and implement it.';

    return [
      'EXECUTE PHASE',
      `Iteration: ${iteration}`,
      '',
      'Keep output concise and avoid dumping full file contents or long logs.',
      'If you need to reference code, cite paths and describe changes instead of pasting whole files.',
      '',
      'Output contract:',
      '- Start with "PLAN:" then 2-5 bullets.',
      '- Do the work.',
      '- End with "IMPLEMENTATION SUMMARY:" bullets:',
      '  - Changed: (paths only, 10 max)',
      '  - Commands: (what you ran)',
      '  - Notes:',
      '',
      `Task for this iteration: ${instruction}`,
      '',
      'Do not output JSON in this phase.',
      ''
    ].join('\n');
  }

  function buildVerifyPrompt({ taskId, task, stagePrompt, stageRequirement, gitSummary, verifyResults, iteration, lastRunPath }) {
    const title = String(task?.title || taskId || '').trim();
    const contentRaw = String(task?.content || '').trim();
    const content = contentRaw.length > 2500 ? `${contentRaw.slice(0, 2500)}\n[truncated]` : contentRaw;

    const diffStat = gitSummary?.diff_stat ? String(gitSummary.diff_stat).trim() : '';
    const statusPorcelain = gitSummary?.status_porcelain ? String(gitSummary.status_porcelain).trim() : '';
    const statusShort = statusPorcelain ? statusPorcelain.split('\n').slice(0, 80).join('\n') : '';
    const diffShort = diffStat ? diffStat.split('\n').slice(0, 60).join('\n') : '';

    const commands = Array.isArray(verifyResults) ? verifyResults : [];
    const cmdLines = commands.length
      ? commands.map((r) => {
        const code = typeof r.exit_code === 'number' ? r.exit_code : null;
        const label = r.label || `${r.cmd} ${(r.args || []).join(' ')}`.trim();
        const dur = typeof r.duration_ms === 'number' ? `${r.duration_ms}ms` : '';
        return `- ${label} => exit=${code} ${dur}`.trim();
      }).join('\n')
      : '- (no verification commands detected)';

    const runRoot = lastRunPath ? String(lastRunPath) : '';

    const prompt = `You are the verifier for an agx run.

Task ID: ${taskId}
Title: ${title || taskId}
Stage: ${task?.stage || 'unknown'}
Iteration: ${iteration}

Stage Objective: ${stagePrompt}
Stage Completion Requirement: ${stageRequirement}

Local run artifacts folder: ${runRoot || '(not available)'}

User Request:
"""
${title}
${content}
"""

Repo summary (git):
Status (porcelain):
${statusShort || '(none)'}

Diff (stat):
${diffShort || '(none)'}

Verification commands:
${cmdLines}

Decide if the stage is complete. Use verification commands as evidence.
Ignore unrelated working tree changes; focus on whether the user request is satisfied.
If not complete, provide the next smallest instruction for another iteration.
Set "done": true when the user request is satisfied and the evidence supports it. Treat the stage objective/requirement as guidance, not a keyword checklist.

Output contract (strict): your response MUST be exactly one raw JSON object with this shape:
{
  "done": false,
  "decision": "done|blocked|not_done|failed",
  "explanation": "clear explanation of the decision",
  "final_result": "final result if done, empty string otherwise",
  "next_prompt": "specific actionable instruction for next iteration",
  "summary": "brief summary of current state",
  "plan_md": "PLAN markdown for this iteration (newlines escaped)",
  "implementation_summary_md": "IMPLEMENTATION SUMMARY markdown (newlines escaped)",
  "verification_md": "VERIFICATION markdown (newlines escaped)"
}

Rules:
- Use double-quoted keys and strings.
- Keep newlines escaped inside strings (use \\n).
- Keep the markdown fields short and checklist-style.
- Always fill "explanation". For "blocked", include what is blocking and what input/action would unblock. For "failed", include what failed (command/tool/error) and a recovery step.
`;

    return (typeof truncateForPrompt === 'function'
      ? truncateForPrompt(prompt, VERIFY_PROMPT_MAX_CHARS)
      : truncateForPromptLocal(prompt, VERIFY_PROMPT_MAX_CHARS));
  }

  return {
    resolveAggregatorModel,
    buildAggregatorPrompt,
    truncateForPrompt: truncateForPromptLocal,
    buildExecuteIterationPrompt,
    buildVerifyPrompt,
  };
}

module.exports = { createCloudPromptHelpers };

