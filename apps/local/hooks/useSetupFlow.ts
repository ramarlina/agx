// hooks/useSetupFlow.ts
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

export type SetupStep = 1 | 2;

export function useSetupFlow() {
  const router = useRouter();
  const [step, setStep] = useState<SetupStep>(1);

  const goNext = useCallback(() => {
    setStep((s) => Math.min(s + 1, 2) as SetupStep);
  }, []);

  const goBack = useCallback(() => {
    setStep((s) => Math.max(s - 1, 1) as SetupStep);
  }, []);

  const finish = useCallback(() => {
    router.push("/");
  }, [router]);

  return { step, goNext, goBack, finish };
}
