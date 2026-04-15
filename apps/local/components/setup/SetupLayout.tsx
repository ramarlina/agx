// components/setup/SetupLayout.tsx
"use client";

import { StepIndicator } from "./StepIndicator";

interface SetupLayoutProps {
  currentStep: number;
  totalSteps: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}

export function SetupLayout({ currentStep, totalSteps, children, footer, wide }: SetupLayoutProps) {
  const maxW = wide ? "max-w-6xl" : "max-w-2xl";
  return (
    <div className="h-screen w-full flex flex-col bg-[var(--background)]">
      {/* Header with step indicator */}
      <div className="flex items-center justify-center pt-8 pb-4">
        <StepIndicator currentStep={currentStep} totalSteps={totalSteps} />
      </div>

      {/* Content area — scrollable */}
      <div className="flex-1 overflow-y-auto px-4 min-h-0">
        <div className={`${maxW} mx-auto w-full py-6 h-full`}>
          {children}
        </div>
      </div>

      {/* Footer — sticky at bottom */}
      {footer && (
        <div className="border-t border-[var(--border)] bg-[var(--background)] px-4 py-4">
          <div className={`${maxW} mx-auto w-full`}>
            {footer}
          </div>
        </div>
      )}
    </div>
  );
}
