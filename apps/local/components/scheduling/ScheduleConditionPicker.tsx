"use client";

import React, { useEffect, useEffectEvent, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cronToHuman } from "@/src/graph/nl-schedule";
import { isValidCronExpression } from "@/src/prompt-scheduler/cron";

const DAYS_OF_WEEK = [
  { label: "Sun", short: "S", full: "Sunday", value: 0 },
  { label: "Mon", short: "M", full: "Monday", value: 1 },
  { label: "Tue", short: "T", full: "Tuesday", value: 2 },
  { label: "Wed", short: "W", full: "Wednesday", value: 3 },
  { label: "Thu", short: "T", full: "Thursday", value: 4 },
  { label: "Fri", short: "F", full: "Friday", value: 5 },
  { label: "Sat", short: "S", full: "Saturday", value: 6 },
];

const SCHEDULE_TYPES = [
  { id: "minutes", label: "Minutes" },
  { id: "hourly", label: "Hourly" },
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "custom", label: "Custom" },
] as const;

export type ScheduleTab = (typeof SCHEDULE_TYPES)[number]["id"];

export interface ScheduleDraft {
  tab: ScheduleTab;
  minuteInterval: number;
  hourInterval: number;
  minute: number;
  hour: number;
  selectedDays: number[];
  dayOfMonth: number;
  customCron: string;
}

export interface ScheduleConditionValue {
  cadence: string;
  condition: string;
}

interface ScheduleConditionPickerProps {
  value: ScheduleConditionValue;
  onChange: (nextValue: ScheduleConditionValue, meta: { isScheduleValid: boolean }) => void;
  allowEmptySchedule?: boolean;
  scheduleLabel?: string;
  conditionLabel?: string;
  conditionHelpText?: string;
}

const DEFAULT_SCHEDULE_DRAFT: ScheduleDraft = {
  tab: "daily",
  minuteInterval: 5,
  hourInterval: 1,
  minute: 0,
  hour: 9,
  selectedDays: [1, 2, 3, 4, 5],
  dayOfMonth: 1,
  customCron: "* * * * *",
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest mb-2">
      {children}
    </label>
  );
}

function padCronNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeSelectedDays(days: number[]): number[] {
  return [...new Set(days)]
    .filter((day) => day >= 0 && day <= 6)
    .sort((left, right) => left - right);
}

export function buildScheduleCron(draft: ScheduleDraft): string {
  const days = normalizeSelectedDays(draft.selectedDays);

  switch (draft.tab) {
    case "minutes":
      return `*/${draft.minuteInterval} * * * *`;
    case "hourly":
      return draft.hourInterval === 1
        ? `${draft.minute} * * * *`
        : `${draft.minute} */${draft.hourInterval} * * *`;
    case "daily":
      return `${draft.minute} ${draft.hour} * * *`;
    case "weekly":
      return `${draft.minute} ${draft.hour} * * ${days.length === 0 || days.length === 7 ? "*" : days.join(",")}`;
    case "monthly":
      return `${draft.minute} ${draft.hour} ${draft.dayOfMonth} * *`;
    case "custom":
      return draft.customCron.trim();
    default:
      return `${draft.minute} ${draft.hour} * * *`;
  }
}

export function buildScheduleDescription(draft: ScheduleDraft): string {
  const days = normalizeSelectedDays(draft.selectedDays);
  const time = `${padCronNumber(draft.hour)}:${padCronNumber(draft.minute)}`;

  switch (draft.tab) {
    case "minutes":
      return `Every ${draft.minuteInterval} minute${draft.minuteInterval === 1 ? "" : "s"}`;
    case "hourly":
      return draft.hourInterval === 1
        ? `Every hour at minute ${padCronNumber(draft.minute)}`
        : `Every ${draft.hourInterval} hours at minute ${padCronNumber(draft.minute)}`;
    case "daily":
      return `Every day at ${time}`;
    case "weekly":
      if (days.length === 0 || days.length === 7) {
        return `Every day at ${time}`;
      }
      return `Every ${days.map((day) => DAYS_OF_WEEK.find((item) => item.value === day)?.full ?? day).join(", ")} at ${time}`;
    case "monthly":
      return `On day ${draft.dayOfMonth} of the month at ${time}`;
    case "custom":
      return cronToHuman(draft.customCron.trim()) ?? "Custom cron expression";
    default:
      return `Every day at ${time}`;
  }
}

export function parseScheduleValue(value: string): ScheduleDraft {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_SCHEDULE_DRAFT;
  }

  const minuteMatch = trimmed.match(/^\*\/(\d{1,2}) \* \* \* \*$/);
  if (minuteMatch) {
    return {
      ...DEFAULT_SCHEDULE_DRAFT,
      tab: "minutes",
      minuteInterval: Number(minuteMatch[1]),
    };
  }

  const hourlyMatch = trimmed.match(/^(\d{1,2}) \*\/(\d{1,2}) \* \* \*$/);
  if (hourlyMatch) {
    return {
      ...DEFAULT_SCHEDULE_DRAFT,
      tab: "hourly",
      minute: Number(hourlyMatch[1]),
      hourInterval: Number(hourlyMatch[2]),
    };
  }

  const everyHourMatch = trimmed.match(/^(\d{1,2}) \* \* \* \*$/);
  if (everyHourMatch) {
    return {
      ...DEFAULT_SCHEDULE_DRAFT,
      tab: "hourly",
      minute: Number(everyHourMatch[1]),
      hourInterval: 1,
    };
  }

  const weeklyMatch = trimmed.match(/^(\d{1,2}) (\d{1,2}) \* \* ([0-6](?:,[0-6])*)$/);
  if (weeklyMatch) {
    return {
      ...DEFAULT_SCHEDULE_DRAFT,
      tab: "weekly",
      minute: Number(weeklyMatch[1]),
      hour: Number(weeklyMatch[2]),
      selectedDays: weeklyMatch[3].split(",").map((item) => Number(item)),
    };
  }

  const dailyMatch = trimmed.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (dailyMatch) {
    return {
      ...DEFAULT_SCHEDULE_DRAFT,
      tab: "daily",
      minute: Number(dailyMatch[1]),
      hour: Number(dailyMatch[2]),
    };
  }

  const monthlyMatch = trimmed.match(/^(\d{1,2}) (\d{1,2}) (\d{1,2}) \* \*$/);
  if (monthlyMatch) {
    return {
      ...DEFAULT_SCHEDULE_DRAFT,
      tab: "monthly",
      minute: Number(monthlyMatch[1]),
      hour: Number(monthlyMatch[2]),
      dayOfMonth: Number(monthlyMatch[3]),
    };
  }

  return {
    ...DEFAULT_SCHEDULE_DRAFT,
    tab: "custom",
    customCron: trimmed,
  };
}

export function SimpleDropdown<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  buttonClassName = "w-full",
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className={`relative ${buttonClassName}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="w-full flex items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--muted)] px-3 py-2 text-left text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--muted-foreground)]"
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? String(value)}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] shadow-lg">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted)] ${
                  isSelected ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ScheduleConditionPicker({
  value,
  onChange,
  allowEmptySchedule = false,
  scheduleLabel = "Schedule",
  conditionLabel = "Condition",
  conditionHelpText = "Scheduled runs and Run now will check this condition before executing.",
}: ScheduleConditionPickerProps) {
  const [draft, setDraft] = useState<ScheduleDraft>(() => parseScheduleValue(value.cadence));
  const [condition, setCondition] = useState(value.condition);
  const [conditionMode, setConditionMode] = useState<"always" | "gated">(
    value.condition.trim() ? "gated" : "always",
  );
  const [scheduleMode, setScheduleMode] = useState<"unset" | "scheduled">(
    allowEmptySchedule && !value.cadence.trim() ? "unset" : "scheduled",
  );
  const emitChange = useEffectEvent(onChange);
  const lastSyncedRef = useRef({
    cadence: value.cadence.trim(),
    condition: value.condition.trim(),
  });
  const lastEmittedRef = useRef({
    cadence: value.cadence.trim(),
    condition: value.condition.trim(),
    isScheduleValid: true,
  });

  const generatedCron = buildScheduleCron(draft);
  const generatedDescription = buildScheduleDescription(draft);
  const isScheduleValid = scheduleMode === "unset" || draft.tab !== "custom" || isValidCronExpression(generatedCron);

  useEffect(() => {
    const nextCadence = value.cadence.trim();
    const nextCondition = value.condition.trim();
    if (
      nextCadence === lastSyncedRef.current.cadence
      && nextCondition === lastSyncedRef.current.condition
    ) {
      return;
    }

    lastSyncedRef.current = { cadence: nextCadence, condition: nextCondition };
    setDraft(parseScheduleValue(nextCadence));
    setCondition(value.condition);
    setConditionMode(nextCondition ? "gated" : "always");
    if (allowEmptySchedule) {
      setScheduleMode(nextCadence ? "scheduled" : "unset");
    }
  }, [allowEmptySchedule, value.cadence, value.condition]);

  useEffect(() => {
    const nextValue = {
      cadence: scheduleMode === "scheduled" ? generatedCron : "",
      condition: scheduleMode === "scheduled" && conditionMode === "gated" ? condition.trim() : "",
    };
    if (
      nextValue.cadence === lastEmittedRef.current.cadence
      && nextValue.condition === lastEmittedRef.current.condition
      && isScheduleValid === lastEmittedRef.current.isScheduleValid
    ) {
      return;
    }

    lastSyncedRef.current = {
      cadence: nextValue.cadence.trim(),
      condition: nextValue.condition.trim(),
    };
    lastEmittedRef.current = {
      cadence: nextValue.cadence.trim(),
      condition: nextValue.condition.trim(),
      isScheduleValid,
    };
    emitChange(nextValue, { isScheduleValid });
  }, [condition, conditionMode, emitChange, generatedCron, isScheduleValid, scheduleMode]);

  const toggleDay = (day: number) =>
    setDraft((current) => ({
      ...current,
      selectedDays: current.selectedDays.includes(day)
        ? current.selectedDays.filter((item) => item !== day)
        : [...current.selectedDays, day],
    }));

  const minuteIntervalOptions = Array.from({ length: 59 }, (_, index) => ({
    value: index + 1,
    label: String(index + 1),
  }));
  const hourIntervalOptions = Array.from({ length: 23 }, (_, index) => ({
    value: index + 1,
    label: String(index + 1),
  }));
  const hourOptions = Array.from({ length: 24 }, (_, index) => ({
    value: index,
    label: padCronNumber(index),
  }));
  const minuteOptions = Array.from({ length: 60 }, (_, index) => ({
    value: index,
    label: padCronNumber(index),
  }));

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <FieldLabel>{scheduleLabel}</FieldLabel>
        {allowEmptySchedule ? (
          <SimpleDropdown
            value={scheduleMode}
            onChange={(nextMode) => setScheduleMode(nextMode)}
            options={[
              { value: "unset", label: "Not set" },
              { value: "scheduled", label: "Scheduled" },
            ]}
            ariaLabel="Schedule mode"
          />
        ) : null}

        {scheduleMode === "scheduled" ? (
          <div className="space-y-4">
            <SimpleDropdown
              value={draft.tab}
              onChange={(nextTab) => setDraft((current) => ({ ...current, tab: nextTab as ScheduleTab }))}
              options={SCHEDULE_TYPES.map((type) => ({ value: type.id, label: type.label }))}
              ariaLabel="Schedule type"
            />

            {draft.tab === "minutes" && (
              <div className="flex items-center gap-3 rounded-lg border border-[var(--card-border)] bg-[var(--muted)] px-3 py-3">
                <span className="text-sm text-[var(--muted-foreground)]">Every</span>
                <SimpleDropdown
                  value={draft.minuteInterval}
                  onChange={(minuteInterval) => setDraft((current) => ({ ...current, minuteInterval }))}
                  options={minuteIntervalOptions}
                  ariaLabel="Minute interval"
                  buttonClassName="w-20"
                />
                <span className="text-sm text-[var(--muted-foreground)]">minute(s)</span>
              </div>
            )}

            {draft.tab === "hourly" && (
              <div className="space-y-2">
                <FieldLabel>Hourly Schedule</FieldLabel>
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--muted)] px-3 py-3">
                  <span className="text-sm text-[var(--muted-foreground)]">Every</span>
                  <SimpleDropdown
                    value={draft.hourInterval}
                    onChange={(hourInterval) => setDraft((current) => ({ ...current, hourInterval }))}
                    options={hourIntervalOptions}
                    ariaLabel="Hour interval"
                    buttonClassName="w-20"
                  />
                  <span className="text-sm text-[var(--muted-foreground)]">hour(s) at minute</span>
                  <SimpleDropdown
                    value={draft.minute}
                    onChange={(minute) => setDraft((current) => ({ ...current, minute }))}
                    options={minuteOptions}
                    ariaLabel="Minute"
                    buttonClassName="w-24"
                  />
                </div>
              </div>
            )}

            {(draft.tab === "daily" || draft.tab === "weekly" || draft.tab === "monthly") && (
              <div className="space-y-2">
                <FieldLabel>Time</FieldLabel>
                <div className="flex items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--muted)] px-3 py-3">
                  <SimpleDropdown
                    value={draft.hour}
                    onChange={(hour) => setDraft((current) => ({ ...current, hour }))}
                    options={hourOptions}
                    ariaLabel="Hour"
                    buttonClassName="w-24"
                  />
                  <span className="text-sm font-bold text-[var(--muted-foreground)]">:</span>
                  <SimpleDropdown
                    value={draft.minute}
                    onChange={(minute) => setDraft((current) => ({ ...current, minute }))}
                    options={minuteOptions}
                    ariaLabel="Minute"
                    buttonClassName="w-24"
                  />
                </div>
              </div>
            )}

            {draft.tab === "weekly" && (
              <div>
                <FieldLabel>Repeat On</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS_OF_WEEK.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleDay(day.value)}
                      className={`size-8 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                        draft.selectedDays.includes(day.value)
                          ? "bg-[var(--foreground)] text-[var(--background)]"
                          : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--card-border)]"
                      }`}
                      title={day.full}
                    >
                      {day.short}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {draft.tab === "monthly" && (
              <div>
                <FieldLabel>On Day</FieldLabel>
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: 31 }).map((_, index) => {
                    const dayOfMonth = index + 1;
                    return (
                      <button
                        key={dayOfMonth}
                        type="button"
                        onClick={() => setDraft((current) => ({ ...current, dayOfMonth }))}
                        className={`size-7 rounded-lg flex items-center justify-center text-[10px] font-medium transition-all ${
                          draft.dayOfMonth === dayOfMonth
                            ? "bg-[var(--foreground)] text-[var(--background)]"
                            : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--card-border)]"
                        }`}
                      >
                        {dayOfMonth}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {draft.tab === "custom" && (
              <div className="space-y-2">
                <FieldLabel>Custom Cron</FieldLabel>
                <textarea
                  value={draft.customCron}
                  onChange={(event) => setDraft((current) => ({ ...current, customCron: event.target.value }))}
                  rows={3}
                  spellCheck={false}
                  className="w-full resize-none rounded-lg border border-[var(--card-border)] bg-[var(--muted)] px-3 py-2 font-mono text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--foreground)] transition-colors"
                  placeholder="* * * * *"
                />
                {!isScheduleValid && (
                  <p className="text-[10px] text-red-400">
                    Enter a valid 5-field cron expression in the format minute hour day-of-month month day-of-week.
                  </p>
                )}
              </div>
            )}

            <p className="text-[10px] text-[var(--muted-foreground)]">
              {generatedDescription}
            </p>
          </div>
        ) : (
          <p className="text-xs text-[var(--muted-foreground)]">
            Leave this unset if the objective does not need a recurring wake-up schedule.
          </p>
        )}
      </div>

      {scheduleMode === "scheduled" ? (
        <div className="space-y-3">
          <FieldLabel>{conditionLabel}</FieldLabel>
          <SimpleDropdown
            value={conditionMode}
            onChange={(mode) => setConditionMode(mode)}
            options={[
              { value: "always", label: "Always run" },
              { value: "gated", label: "Only run if" },
            ]}
            ariaLabel="Condition mode"
          />
          {conditionMode === "gated" ? (
            <>
              <textarea
                value={condition}
                onChange={(event) => setCondition(event.target.value)}
                placeholder="there are unread emails in my inbox"
                rows={3}
                className="w-full resize-none rounded-lg border border-[var(--card-border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--foreground)] transition-colors"
              />
              <p className="text-[10px] text-[var(--muted-foreground)]">
                {conditionHelpText}
              </p>
            </>
          ) : (
            <p className="text-[10px] text-[var(--muted-foreground)]">
              Runs without checking any additional condition.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
