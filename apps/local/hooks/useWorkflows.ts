"use client";

import { useMemo, useCallback } from "react";

export interface StageConfig {
    icon: string;
    label: string;
    color: string;
}

export const FALLBACK_STAGES = ["INTAKE", "PROGRESS", "DONE"] as const;

export const FALLBACK_STAGE_CONFIG: Record<string, StageConfig> = {
    INTAKE: { icon: "📥", label: "Intake", color: "var(--warning)" },
    PROGRESS: { icon: "🔄", label: "Progress", color: "var(--primary)" },
    DONE: { icon: "✅", label: "Done", color: "var(--success)" },
};

export const DEFAULT_WORKFLOW_ID = "00000000-0000-0000-0000-000000000001";

interface UseWorkflowsResult {
    workflow: null;
    stages: string[];
    stageConfig: Record<string, StageConfig>;
    transitions: never[];
    isLoading: false;
    error: null;
    refetch: () => void;
    isValidTransition: (fromStage: string, toStage: string) => boolean;
}

export function useWorkflows(): UseWorkflowsResult {
    const stages = useMemo(() => [...FALLBACK_STAGES], []);
    const stageConfig = FALLBACK_STAGE_CONFIG;

    const isValidTransition = useCallback((fromStage: string, toStage: string): boolean => {
        if (fromStage === toStage) return true;
        const fromIndex = FALLBACK_STAGES.indexOf(fromStage as any);
        const toIndex = FALLBACK_STAGES.indexOf(toStage as any);
        // Allow moving backward (reopening) or forward by one
        return toIndex < fromIndex || toIndex === fromIndex + 1;
    }, []);

    return {
        workflow: null,
        stages,
        stageConfig,
        transitions: [],
        isLoading: false,
        error: null,
        refetch: () => {},
        isValidTransition,
    };
}
