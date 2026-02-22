'use strict';

const STAGE_REQUIREMENTS = {
  intake: {
    artifact: 'idea',
    guidance: 'A concrete idea with scope, approach, and key unknowns.'
  },
  planning: {
    artifact: 'plan',
    guidance: 'A concrete execution plan with tasks/milestones and dependencies.'
  }
};

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is', 'it',
  'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with', 'your', 'you', 'use', 'create',
  'build', 'ensure', 'verify', 'work', 'stage', 'task', 'complete'
]);

function getStageRequirement(stage) {
  const key = String(stage || '').toLowerCase();
  return STAGE_REQUIREMENTS[key] || null;
}

function resolveStageObjective(task, stage, fallbackObjective = '') {
  const stageKey = String(stage || '').toLowerCase();
  const prompts = task?.stage_prompts;

  console.log('Stage Prompts:', prompts);

  if (prompts && typeof prompts === 'object' && !Array.isArray(prompts)) {
    const direct = prompts[stageKey] || prompts[stage];
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    const normalizedKey = Object.keys(prompts).find((key) => String(key).toLowerCase() === stageKey);
    if (normalizedKey && typeof prompts[normalizedKey] === 'string' && prompts[normalizedKey].trim()) {
      return prompts[normalizedKey].trim();
    }
  }

  if (Array.isArray(prompts)) {
    const found = prompts.find((entry) => {
      const key = String(entry?.stage || entry?.name || '').toLowerCase();
      return key === stageKey;
    });
    const text = found?.prompt || found?.objective || found?.requirement;
    if (typeof text === 'string' && text.trim()) return text.trim();
  }

  if (typeof fallbackObjective === 'string' && fallbackObjective.trim()) {
    return fallbackObjective.trim();
  }
  console.log('No stage objective defined.', task, stage, fallbackObjective);
  return 'No stage objective defined.';
}

function extractPromptKeywords(stagePrompt) {
  if (typeof stagePrompt !== 'string' || !stagePrompt.trim()) return [];
  const words = stagePrompt.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || [];
  const unique = Array.from(new Set(words.filter((word) => !STOP_WORDS.has(word))));
  return unique.slice(0, 8);
}

function decisionText(decision) {
  return [decision?.final_result, decision?.summary, decision?.explanation, decision?.plan_md]
    .filter((v) => typeof v === 'string')
    .join('\n')
    .toLowerCase();
}

function buildStageRequirementPrompt({ stage, stagePrompt }) {
  const req = getStageRequirement(stage);
  if (req) {
    return `This stage is only complete when a clear ${req.artifact} is provided. ${req.guidance}`;
  }
  if (typeof stagePrompt === 'string' && stagePrompt.trim()) {
    return `This stage is only complete when the result clearly satisfies this objective: ${stagePrompt.trim()}`;
  }
  return 'No additional stage artifact requirement.';
}

function hasRequiredArtifact(stage, decision, stagePrompt) {
  const req = getStageRequirement(stage);
  const text = decisionText(decision);
  if (!text.trim()) return false;

  if (!req) {
    const keywords = extractPromptKeywords(stagePrompt);
    if (keywords.length === 0) return true;
    return keywords.some((keyword) => text.includes(keyword));
  }

  if (req.artifact === 'idea') {
    return /\bidea\b|\bapproach\b|\bscope\b|\bresearch\b|\bunknowns?\b/.test(text);
  }

  if (req.artifact === 'plan') {
    return /\bplan\b|\bmilestone\b|\bdependency\b|\btask(?:s)?\b|\bstep\s*\d+\b/.test(text);
  }

  return true;
}

function enforceStageRequirement(decision, { stage, stagePrompt }) {
  if (!decision || typeof decision !== 'object') return decision;
  if (!decision.done) return decision;

  const req = getStageRequirement(stage);
  // Only enforce explicit artifact requirements (intake/planning today). For other stages, the
  // verifier/aggregator decision stands; we should not require keyword echoes from stage prompts.
  if (!req) return decision;
  if (hasRequiredArtifact(stage, decision, stagePrompt)) return decision;

  const baseExplanation = typeof decision.explanation === 'string' ? decision.explanation.trim() : '';
  const requirementMsg = req
    ? `Stage '${stage}' requires a concrete ${req.artifact} before completion.`
    : `Stage '${stage}' completion must satisfy this objective: ${stagePrompt.trim()}`;
  const explanation = baseExplanation ? `${baseExplanation} ${requirementMsg}` : requirementMsg;

  return {
    ...decision,
    done: false,
    decision: decision.decision === 'blocked' ? 'blocked' : 'not_done',
    explanation,
    summary: decision.summary || requirementMsg,
    next_prompt: decision.next_prompt && decision.next_prompt.trim()
      ? decision.next_prompt
      : req
        ? `Produce a clear ${req.artifact} for the ${stage} stage. ${req.guidance}`
        : `Provide a concrete result that satisfies the ${stage} objective: ${stagePrompt.trim()}`
  };
}

module.exports = {
  STAGE_REQUIREMENTS,
  getStageRequirement,
  resolveStageObjective,
  buildStageRequirementPrompt,
  enforceStageRequirement,
  hasRequiredArtifact
};
