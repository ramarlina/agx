import { toCronExpr } from '../graph/nl-schedule';
import { CronExpressionParser } from 'cron-parser';

export interface ParsedCadence {
  cronExpr: string;
  cadence: string;
}

export interface NormalizedLegacySchedule {
  cadence: string;
  cronExpr: string;
  intervalMs: number;
}

export function parseCadence(input: string): ParsedCadence | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const nlResult = toCronExpr(trimmed);
  if (nlResult) {
    return { cronExpr: nlResult.cronExpr, cadence: nlResult.cadence };
  }

  // Try parsing as raw cron (5 fields)
  if (isValidCronExpression(trimmed)) {
    return { cronExpr: trimmed, cadence: trimmed };
  }

  return null;
}

export function computeNextRun(cronExpr: string, fromMs?: number): number | null {
  try {
    const expr = CronExpressionParser.parse(cronExpr, {
      currentDate: fromMs ? new Date(fromMs) : new Date(),
    });
    return expr.next().toDate().getTime();
  } catch {
    return null;
  }
}

export function formatIntervalCadence(intervalMs: number): string {
  const normalizedMs = Math.max(60_000, intervalMs);

  if (normalizedMs < 3_600_000) {
    const minutes = Math.max(1, Math.ceil(normalizedMs / 60_000));
    return `Every ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  if (normalizedMs < 86_400_000) {
    const hours = Math.max(1, Math.ceil(normalizedMs / 3_600_000));
    return `Every ${hours} hour${hours === 1 ? '' : 's'}`;
  }

  const days = Math.max(1, Math.ceil(normalizedMs / 86_400_000));
  return `Every ${days} day${days === 1 ? '' : 's'}`;
}

export function normalizeLegacyConditionSchedule(checkEveryMs: number): NormalizedLegacySchedule {
  const intervalMs = Math.max(60_000, checkEveryMs);
  const cadence = formatIntervalCadence(intervalMs);
  const parsed = parseCadence(cadence);

  if (!parsed) {
    return {
      cadence: 'Every hour',
      cronExpr: '0 * * * *',
      intervalMs: 3_600_000,
    };
  }

  return {
    cadence: parsed.cadence,
    cronExpr: parsed.cronExpr,
    intervalMs,
  };
}

export function isValidCronExpression(expr: string): boolean {
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return false;
  try {
    CronExpressionParser.parse(expr);
    return true;
  } catch {
    return false;
  }
}
