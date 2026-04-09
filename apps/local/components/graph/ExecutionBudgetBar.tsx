"use client";

import type { ExecutionPolicy } from "@/src/graph/types";

interface ExecutionBudgetBarProps {
  policy: ExecutionPolicy;
}

function toPercent(remaining: number, initial: number): number {
  if (initial <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((remaining / initial) * 100)));
}

function resolveTone(percent: number): "ok" | "warn" | "critical" {
  if (percent <= 30) {
    return "critical";
  }
  if (percent <= 60) {
    return "warn";
  }
  return "ok";
}

export default function ExecutionBudgetBar({ policy }: ExecutionBudgetBarProps) {
  const replanPercent = toPercent(policy.replanBudgetRemaining, policy.replanBudgetInitial);
  const verifyPercent = toPercent(policy.verifyBudgetRemaining, policy.verifyBudgetInitial);

  return (
    <div className="budget-bar">
      <div className="budget-bar__item">
        <div className="budget-bar__header">
          <span>Replans</span>
          <span>
            {policy.replanBudgetRemaining} / {policy.replanBudgetInitial}
          </span>
        </div>
        <div className="budget-bar__track">
          <div
            className={`budget-bar__fill budget-bar__fill--${resolveTone(replanPercent)}`}
            style={{ width: `${replanPercent}%` }}
          />
        </div>
      </div>

      <div className="budget-bar__item">
        <div className="budget-bar__header">
          <span>Verifications</span>
          <span>
            {policy.verifyBudgetRemaining} / {policy.verifyBudgetInitial}
          </span>
        </div>
        <div className="budget-bar__track">
          <div
            className={`budget-bar__fill budget-bar__fill--${resolveTone(verifyPercent)}`}
            style={{ width: `${verifyPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
