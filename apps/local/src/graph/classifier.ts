import type { GraphMode } from './types';

export interface ClassificationSignals {
  estimatedMinutes: number;
  hasExternalDeps: boolean;
  hasParallelWork: boolean;
  requiresVerification: boolean;
  fileCount: number;
  componentCount: number;
  hasMultiplePhases: boolean;
  keywords: string[];
}

export interface ClassificationInput {
  summary?: string;
  description?: string;
  estimatedMinutes?: number;
  hasExternalDeps?: boolean;
  hasParallelWork?: boolean;
  requiresVerification?: boolean;
  fileCount?: number;
  componentCount?: number;
  hasMultiplePhases?: boolean;
  keywords?: string[];
}

const KEYWORD_CANDIDATES = [
  'bugfix',
  'docs',
  'feature',
  'hotfix',
  'integration',
  'migration',
  'refactor',
  'rollback',
  'spike',
  'test',
];

const EXTERNAL_DEP_PATTERNS = [
  /\bapi\b/,
  /\bservice\b/,
  /\bvendor\b/,
  /\bexternal\b/,
  /\bdependency\b/,
  /\bapproval\b/,
  /\breview\b/,
  /\bstakeholder\b/,
  /\bthird[- ]party\b/,
];

const PARALLEL_PATTERNS = [
  /\bparallel\b/,
  /\bconcurrent\b/,
  /\bworkstreams?\b/,
  /\bmultiple paths?\b/,
  /\bindependent streams?\b/,
  /\bin parallel\b/,
];

const VERIFICATION_PATTERNS = [
  /\btest(s|ing)?\b/,
  /\bqa\b/,
  /\bverify\b/,
  /\bverification\b/,
  /\breview\b/,
  /\bapproval\b/,
  /\bvalidate\b/,
  /\bcheck(s)?\b/,
];

const MULTI_PHASE_PATTERNS = [
  /\bphase(s)?\b/,
  /\bdesign\b.*\bimplement\b/,
  /\bplan\b.*\bimplement\b/,
  /\bimplement\b.*\btest\b/,
  /\bthen\b/,
  /\b->\b/,
];

function normalizeText(input: ClassificationInput): string {
  return `${input.summary ?? ''} ${input.description ?? ''}`.toLowerCase();
}

function inferCount(text: string, patterns: RegExp[], fallback: number): number {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match || !match[1]) {
      continue;
    }

    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return fallback;
}

function hasAnyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function sanitizeCount(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.round(value));
}

function sanitizeEstimate(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.round(value));
}

function inferKeywords(text: string, provided: string[] | undefined): string[] {
  const normalizedProvided = (provided ?? [])
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);

  const matched = KEYWORD_CANDIDATES.filter((keyword) =>
    new RegExp(`\\b${keyword}\\b`, 'i').test(text),
  );

  return Array.from(new Set([...normalizedProvided, ...matched]));
}

export function extractClassificationSignals(input: ClassificationInput): ClassificationSignals {
  const normalizedText = normalizeText(input);
  const keywords = inferKeywords(normalizedText, input.keywords);

  const fileCount =
    typeof input.fileCount === 'number'
      ? sanitizeCount(input.fileCount, 1)
      : inferCount(
          normalizedText,
          [/\b(\d+)\s+files?\b/, /\b(\d+)\s+changed files?\b/],
          1,
        );

  const componentCount =
    typeof input.componentCount === 'number'
      ? sanitizeCount(input.componentCount, 1)
      : inferCount(
          normalizedText,
          [/\b(\d+)\s+components?\b/, /\b(\d+)\s+modules?\b/],
          1,
        );

  const hasExternalDeps =
    input.hasExternalDeps ?? hasAnyMatch(normalizedText, EXTERNAL_DEP_PATTERNS);

  const hasParallelWork =
    input.hasParallelWork ??
    (hasAnyMatch(normalizedText, PARALLEL_PATTERNS) || componentCount >= 3);

  const requiresVerification =
    input.requiresVerification ??
    (hasAnyMatch(normalizedText, VERIFICATION_PATTERNS) || keywords.includes('test'));

  const hasMultiplePhases =
    input.hasMultiplePhases ??
    (hasAnyMatch(normalizedText, MULTI_PHASE_PATTERNS) ||
      (requiresVerification && componentCount > 1));

  const inferredEstimate =
    15 +
    fileCount * 6 +
    Math.max(componentCount - 1, 0) * 12 +
    (hasExternalDeps ? 20 : 0) +
    (hasParallelWork ? 15 : 0) +
    (requiresVerification ? 15 : 0) +
    (hasMultiplePhases ? 20 : 0) +
    (keywords.includes('migration') ? 30 : 0) +
    (keywords.includes('refactor') ? 15 : 0) +
    (keywords.includes('hotfix') ? -8 : 0) +
    (keywords.includes('docs') ? -5 : 0);

  const estimatedMinutes = sanitizeEstimate(input.estimatedMinutes, inferredEstimate);

  return {
    estimatedMinutes,
    hasExternalDeps,
    hasParallelWork,
    requiresVerification,
    fileCount,
    componentCount,
    hasMultiplePhases,
    keywords,
  };
}

export function classify(signals: ClassificationSignals): GraphMode {
  if (
    signals.estimatedMinutes < 30 &&
    !signals.hasParallelWork &&
    !signals.requiresVerification
  ) {
    return 'SIMPLE';
  }

  return 'PROJECT';
}
