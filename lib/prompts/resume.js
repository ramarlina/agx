'use strict';

const { estimateTokens } = require('../storage/prompt_builder');

const SECTION_TOKEN_BUDGETS = {
  objective: 600,
  criteria: 500,
  plan: 400,
  dontRepeat: 200,
  constraints: 100,
};

const STABILITY_INSTRUCTIONS =
  'Continue from current step. Do not rewrite the plan structure. Complete steps in order.';

const PASS_STATUSES = new Set(['pass', 'passed', 'done', 'complete', 'success', 'ok']);
const FAIL_STATUSES = new Set(['fail', 'failed', 'blocked', 'error', 'halt', 'abort']);

function buildResumePrompt(checkpoint = {}) {
  const sections = [];

  const objectiveSection = buildObjectiveSection(checkpoint);
  if (objectiveSection) {
    sections.push(applyBudget('objective', objectiveSection));
  }

  const criteriaSection = buildCriteriaSection(checkpoint);
  if (criteriaSection) {
    sections.push(applyBudget('criteria', criteriaSection));
  }

  const planSection = buildPlanSection(checkpoint);
  if (planSection) {
    sections.push(applyBudget('plan', planSection));
  }

  const dontRepeatSection = buildListSection(
    'Dont Repeat',
    extractListFromCheckpoint(checkpoint, ['dontRepeat', 'dont_repeat', 'dont_repeat_items', 'dont_repeat_notes'])
  );
  if (dontRepeatSection) {
    sections.push(applyBudget('dontRepeat', dontRepeatSection));
  }

  const constraintsSection = buildListSection(
    'Dont Break',
    extractListFromCheckpoint(checkpoint, ['constraints', 'constraint', 'dont_break', 'limits'])
  );
  if (constraintsSection) {
    sections.push(applyBudget('constraints', constraintsSection));
  }

  const body = sections.filter(Boolean).join('\n\n').trim();
  if (body) {
    return `${body}\n\n${STABILITY_INSTRUCTIONS}`;
  }

  return STABILITY_INSTRUCTIONS;
}

function buildObjectiveSection(checkpoint) {
  const objective = firstAvailableString(checkpoint, [
    'objective',
    'goal',
    'summary',
    'task',
    'description',
    'stageObjective',
    'stage_obj',
  ]);

  return `## Task\n${objective || 'Objective not captured yet.'}`;
}

function buildCriteriaSection(checkpoint) {
  const rawItems = extractCriteriaEntries(checkpoint);
  const lines = normalizeCriteriaItems(rawItems);

  if (!lines.length) {
    return '## Done When\n- (criteria list not provided)';
  }

  return `## Done When\n${lines.map(({ marker, text, suffix }) => `- ${marker} ${text}${suffix}`).join('\n')}`;
}

function buildPlanSection(checkpoint) {
  const rawSteps = resolvePlanSteps(checkpoint);
  if (!rawSteps.length) {
    return '## Plan\n- (plan steps not available)';
  }

  const normalized = normalizePlanSteps(rawSteps, checkpoint);
  if (!normalized.length) {
    return '## Plan\n- (plan steps not available)';
  }

  const lines = normalized.map((step) => {
    const marker = planMarker(step);
    return `- ${marker} ${step.text}`;
  });

  return `## Plan\n${lines.join('\n')}`;
}

function buildListSection(title, entries) {
  const normalized = normalizeSimpleList(entries);
  const header = `## ${title}`;
  if (!normalized.length) {
    return `${header}\n- (none recorded)`;
  }
  return `${header}\n${normalized.map((entry) => `- ${entry}`).join('\n')}`;
}

function applyBudget(sectionName, text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  const budget = SECTION_TOKEN_BUDGETS[sectionName];
  if (!budget || estimateTokens(trimmed) <= budget) {
    return trimmed;
  }
  return truncateToTokens(trimmed, budget);
}

function truncateToTokens(text, maxTokens) {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    return trimmed;
  }

  if (estimateTokens(trimmed) <= maxTokens) {
    return trimmed;
  }

  let approxChars = Math.min(trimmed.length, Math.max(64, Math.floor(maxTokens * 4)));
  let truncated = trimmed.slice(0, approxChars).trim();

  while (estimateTokens(truncated) > maxTokens && approxChars > 0) {
    approxChars = Math.max(0, approxChars - 128);
    truncated = trimmed.slice(0, approxChars).trim();
  }

  if (!truncated) return '';
  return `${truncated}\n\n(Truncated to stay within resume prompt budget)`;
}

function extractCriteriaEntries(checkpoint) {
  const candidates = [checkpoint.criteria, checkpoint.criteria_list, checkpoint.criteriaList];
  for (const candidate of candidates) {
    const entries = normalizeGenericList(candidate);
    if (entries.length) {
      return entries;
    }
  }
  return [];
}

function normalizeCriteriaItems(rawEntries) {
  const items = [];

  for (const entry of rawEntries) {
    const source = typeof entry === 'string' ? { text: entry } : entry;
    if (!source) continue;

    const text = firstAvailableString(source, ['text', 'title', 'description', 'label']);
    if (!text) continue;

    const lowerStatus = (source.status || source.state || '').toString().toLowerCase();
    const passed = Boolean(source.passed || source.pass || PASS_STATUSES.has(lowerStatus));
    const failed = Boolean(source.failed || source.fail || FAIL_STATUSES.has(lowerStatus));

    const marker = passed ? '[x]' : failed ? '[!]' : '[ ]';
    const suffix = passed ? ' (pass)' : failed ? ' (fail)' : '';

    items.push({ marker, text: text.trim(), suffix });
  }

  return items;
}

function resolvePlanSteps(checkpoint) {
  const aliases = [
    checkpoint.plan,
    checkpoint.plan?.steps,
    checkpoint.planSteps,
    checkpoint.plan_entries,
    checkpoint.planEntries,
    checkpoint.steps,
  ];

  for (const candidate of aliases) {
    const normalized = normalizeGenericList(candidate);
    if (normalized.length) {
      return normalized;
    }
  }

  return [];
}

function normalizePlanSteps(entries, checkpoint) {
  const normalized = entries
    .map((entry) => {
      const source = typeof entry === 'string' ? { text: entry } : entry;
      if (!source) return null;

      const text = firstAvailableString(source, ['text', 'title', 'description', 'label', 'name']);
      if (!text) return null;

      const lowerStatus = (source.status || source.state || '').toString().toLowerCase();
      const done = Boolean(source.done || source.completed || PASS_STATUSES.has(lowerStatus));
      const failed = Boolean(source.failed || FAIL_STATUSES.has(lowerStatus));
      const explicitCurrent = Boolean(source.current || source.isCurrent || lowerStatus === 'current');

      return {
        text: text.trim(),
        done,
        failed,
        explicitCurrent,
      };
    })
    .filter(Boolean);

  if (!normalized.length) {
    return [];
  }

  const currentIndex = resolveCurrentStepIndex(normalized, checkpoint);

  return normalized.map((step, index) => ({
    text: step.text,
    done: step.done,
    failed: step.failed,
    current: index === currentIndex,
  }));
}

function resolveCurrentStepIndex(steps, checkpoint) {
  const flaggedIndex = steps.findIndex((step) => step.explicitCurrent);
  if (flaggedIndex >= 0) {
    return flaggedIndex;
  }

  const indexKeys = [
    'currentStepIndex',
    'current_step_index',
    'currentPlanStepIndex',
    'current_plan_step_index',
    'currentPlanIndex',
    'currentPlan',
  ];

  for (const key of indexKeys) {
    const value = checkpoint[key];
    const parsed = typeof value === 'number' ? value : parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed < steps.length) {
      return parsed;
    }
  }

  const currentName = firstAvailableString(checkpoint, [
    'currentStep',
    'current_step',
    'currentPlanStep',
    'current_plan_step',
  ]);
  if (currentName) {
    const lowered = currentName.toLowerCase();
    const byName = steps.findIndex((step) => step.text.toLowerCase() === lowered || step.text.toLowerCase().includes(lowered));
    if (byName >= 0) {
      return byName;
    }
  }

  const firstPending = steps.findIndex((step) => !step.done && !step.failed);
  if (firstPending >= 0) {
    return firstPending;
  }

  return 0;
}

function planMarker(step) {
  if (step.current) return '[→]';
  if (step.failed) return '[!]';
  if (step.done) return '[x]';
  return '[ ]';
}

function extractListFromCheckpoint(checkpoint, keys) {
  if (!checkpoint) return [];
  for (const key of keys) {
    const value = checkpoint[key];
    const normalized = normalizeSimpleList(value);
    if (normalized.length) {
      return normalized;
    }
  }
  return [];
}

function normalizeGenericList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'object') {
    const items = [];
    if (Array.isArray(value.items)) {
      items.push(...value.items);
    } else if (Array.isArray(value.list)) {
      items.push(...value.list);
    } else {
      items.push(...Object.values(value));
    }
    return items;
  }
  return [];
}

function normalizeSimpleList(value) {
  const generic = normalizeGenericList(value);
  return generic
    .map((entry) => {
      if (!entry) return '';
      if (typeof entry === 'string') return entry.trim();
      if (typeof entry === 'object') {
        return firstAvailableString(entry, ['text', 'content', 'description', 'note']) || '';
      }
      return String(entry).trim();
    })
    .filter(Boolean);
}

function firstAvailableString(source, keys) {
  if (!source || typeof source !== 'object') {
    return '';
  }
  for (const key of keys) {
    if (typeof source[key] === 'string' && source[key].trim()) {
      return source[key].trim();
    }
  }
  return '';
}

module.exports = {
  buildResumePrompt,
};
