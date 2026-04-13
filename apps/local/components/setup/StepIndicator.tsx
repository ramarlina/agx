// components/setup/StepIndicator.tsx
"use client";

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

export function StepIndicator({ currentStep, totalSteps }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-0" role="progressbar" aria-valuenow={currentStep} aria-valuemin={1} aria-valuemax={totalSteps} aria-label={`Step ${currentStep} of ${totalSteps}`}>
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1;
        const isActive = step === currentStep;
        const isCompleted = step < currentStep;
        return (
          <div key={step} className="flex items-center">
            {i > 0 && (
              <div className={`w-8 h-[2px] ${isCompleted ? "bg-[var(--foreground)]" : "bg-[var(--border)]"}`} />
            )}
            <div
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                isActive
                  ? "bg-[var(--foreground)] ring-4 ring-[var(--foreground)]/10"
                  : isCompleted
                    ? "bg-[var(--foreground)]"
                    : "bg-[var(--border)]"
              }`}
            />
          </div>
        );
      })}
    </div>
  );
}
