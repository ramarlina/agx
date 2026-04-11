/**
 * Natural language to cron expression parser.
 * Handles common patterns like "every 2 hours", "weekdays at 9am", "daily at midnight".
 * Falls back to returning undefined for expressions that need LLM interpretation.
 */

interface ParsedSchedule {
  cronExpr: string;
  intervalMs?: number;
  cadence: string;
}

const PATTERNS: Array<{
  regex: RegExp;
  handler: (match: RegExpMatchArray) => ParsedSchedule;
}> = [
  // "every N seconds" → intervalMs only (sub-minute)
  {
    regex: /^every\s+(\d+)\s*s(?:ec(?:ond)?s?)?$/i,
    handler: (m) => ({
      cronExpr: `*/${Math.max(1, Math.ceil(parseInt(m[1]) / 60))} * * * *`,
      intervalMs: parseInt(m[1]) * 1000,
      cadence: `Every ${m[1]} seconds`,
    }),
  },
  // "every N minutes"
  {
    regex: /^every\s+(\d+)\s*m(?:in(?:ute)?s?)?$/i,
    handler: (m) => ({
      cronExpr: `*/${m[1]} * * * *`,
      cadence: `Every ${m[1]} minutes`,
    }),
  },
  // "every N hours"
  {
    regex: /^every\s+(\d+)\s*h(?:(?:ou)?rs?)?$/i,
    handler: (m) => ({
      cronExpr: `0 */${m[1]} * * *`,
      cadence: `Every ${m[1]} hours`,
    }),
  },
  // "every hour"
  {
    regex: /^every\s+hour$/i,
    handler: () => ({
      cronExpr: '0 * * * *',
      cadence: 'Every hour',
    }),
  },
  // "every minute"
  {
    regex: /^every\s+minute$/i,
    handler: () => ({
      cronExpr: '* * * * *',
      cadence: 'Every minute',
    }),
  },
  // "daily at N AM/PM" or "daily at HH:MM"
  {
    regex: /^daily\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
    handler: (m) => {
      let hour = parseInt(m[1]);
      const min = parseInt(m[2] || '0');
      const ampm = m[3]?.toLowerCase();
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      return {
        cronExpr: `${min} ${hour} * * *`,
        cadence: `Daily at ${hour}:${String(min).padStart(2, '0')}`,
      };
    },
  },
  // "daily at midnight"
  {
    regex: /^daily\s+at\s+midnight$/i,
    handler: () => ({
      cronExpr: '0 0 * * *',
      cadence: 'Daily at midnight',
    }),
  },
  // "daily at noon"
  {
    regex: /^daily\s+at\s+noon$/i,
    handler: () => ({
      cronExpr: '0 12 * * *',
      cadence: 'Daily at noon',
    }),
  },
  // "weekdays at N AM/PM"
  {
    regex: /^weekdays?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
    handler: (m) => {
      let hour = parseInt(m[1]);
      const min = parseInt(m[2] || '0');
      const ampm = m[3]?.toLowerCase();
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      return {
        cronExpr: `${min} ${hour} * * 1-5`,
        cadence: `Weekdays at ${hour}:${String(min).padStart(2, '0')}`,
      };
    },
  },
  // "mondays at N" / "fridays at N PM"
  {
    regex: /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
    handler: (m) => {
      const dayMap: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
        thursday: 4, friday: 5, saturday: 6,
      };
      const day = dayMap[m[1].toLowerCase()];
      let hour = parseInt(m[2]);
      const min = parseInt(m[3] || '0');
      const ampm = m[4]?.toLowerCase();
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      const dayName = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
      return {
        cronExpr: `${min} ${hour} * * ${day}`,
        cadence: `${dayName}s at ${hour}:${String(min).padStart(2, '0')}`,
      };
    },
  },
  // "every N days"
  {
    regex: /^every\s+(\d+)\s*days?$/i,
    handler: (m) => ({
      cronExpr: `0 0 */${m[1]} * *`,
      cadence: `Every ${m[1]} days`,
    }),
  },
];

/**
 * Parse a natural language schedule string into a cron expression.
 * Returns undefined if the string doesn't match any known pattern.
 */
export function parseNaturalSchedule(input: string): ParsedSchedule | undefined {
  const trimmed = input.trim();
  for (const { regex, handler } of PATTERNS) {
    const match = trimmed.match(regex);
    if (match) {
      return handler(match);
    }
  }
  return undefined;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatTime(hour: number, minute: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}${minute > 0 ? ':' + String(minute).padStart(2, '0') : ''} ${suffix}`;
}

function formatMinuteOffset(minute: number): string {
  return `${minute} minute${minute === 1 ? '' : 's'} past`;
}

/**
 * Convert a cron expression to a human-readable string.
 * Returns undefined if the pattern isn't recognized.
 */
export function cronToHuman(cronExpr: string): string | undefined {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return undefined;
  const [min, hour, dom, mon, dow] = parts;

  // every minute: * * * * *
  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*')
    return 'Every minute';

  // every N minutes: */N * * * *
  if (/^\*\/\d+$/.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*')
    return `Every ${min.slice(2)} minutes`;

  // every hour: 0 * * * * (or N * * * * = at :N every hour)
  if (/^\d+$/.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    const minute = parseInt(min);
    return minute === 0 ? 'Every hour' : `${formatMinuteOffset(minute)} every hour`;
  }

  // every N hours: 0 */N * * *
  if (/^\d+$/.test(min) && /^\*\/\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
    const minute = parseInt(min);
    return minute === 0
      ? `Every ${hour.slice(2)} hours`
      : `${formatMinuteOffset(minute)} every ${hour.slice(2)} hours`;
  }

  // daily at HH:MM
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
    const h = parseInt(hour), m = parseInt(min);
    if (h === 0 && m === 0) return 'Daily at midnight';
    if (h === 12 && m === 0) return 'Daily at noon';
    return `Daily at ${formatTime(h, m)}`;
  }

  // weekdays at HH:MM
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '1-5') {
    const h = parseInt(hour), m = parseInt(min);
    return `Weekdays at ${formatTime(h, m)}`;
  }

  // specific day of week
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && /^\d$/.test(dow)) {
    const h = parseInt(hour), m = parseInt(min), d = parseInt(dow);
    const dayName = DAY_NAMES[d] || dow;
    return `${dayName}s at ${formatTime(h, m)}`;
  }

  // every N days: 0 0 */N * *
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\*\/\d+$/.test(dom) && mon === '*' && dow === '*')
    return `Every ${dom.slice(2)} days`;

  return undefined;
}

/**
 * Convert a cadence string (could be cron or natural language) to a cron expression.
 * Returns the input unchanged if it already looks like a cron expression.
 */
export function toCronExpr(input: string): { cronExpr: string; cadence: string } | undefined {
  const trimmed = input.trim();

  // Already a cron expression (5 space-separated fields)
  if (/^[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+$/.test(trimmed)) {
    return { cronExpr: trimmed, cadence: cronToHuman(trimmed) || trimmed };
  }

  const parsed = parseNaturalSchedule(trimmed);
  if (parsed) {
    return { cronExpr: parsed.cronExpr, cadence: parsed.cadence };
  }

  return undefined;
}
