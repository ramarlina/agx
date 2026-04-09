import { toCronExpr } from '../graph/nl-schedule';
import { CronExpressionParser } from 'cron-parser';

export interface ParsedCadence {
  cronExpr: string;
  cadence: string;
}

export function parseCadence(input: string): ParsedCadence | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const nlResult = toCronExpr(trimmed);
  if (nlResult) {
    return { cronExpr: nlResult.cronExpr, cadence: nlResult.cadence };
  }

  // Try parsing as raw cron (5 fields)
  if (isValidCron(trimmed)) {
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

function isValidCron(expr: string): boolean {
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return false;
  try {
    CronExpressionParser.parse(expr);
    return true;
  } catch {
    return false;
  }
}
