// app/setup/page.tsx
"use client";

import { useProviderStatus } from "@/hooks/useProviderStatus";
import { useSetupFlow } from "@/hooks/useSetupFlow";
import { ProviderStep } from "@/components/setup/ProviderStep";
import { ProjectStep } from "@/components/setup/ProjectStep";
import { TeamsStep } from "@/components/setup/TeamsStep";
import { AlertCircle, Loader2 } from "lucide-react";

export default function SetupPage() {
  const providerStatus = useProviderStatus();
  const flow = useSetupFlow();

  if (flow.completing) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center gap-4 bg-[var(--background)]">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--muted-foreground)]" />
        <p className="text-[14px] text-[var(--muted-foreground)]">Creating your project...</p>
      </div>
    );
  }

  return (
    <>
      {flow.error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950 px-4 py-2 text-[13px] text-red-800 dark:text-red-200 shadow-lg">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {flow.error}
        </div>
      )}

      {flow.step === 1 && (
        <ProviderStep
          clis={providerStatus.clis}
          readyState={providerStatus.readyState as "checking" | "ready" | "needs-setup" | "error"}
          authenticatedCount={providerStatus.authenticatedCount}
          totalCount={providerStatus.totalCount}
          onVerifySuccess={providerStatus.handleVerifySuccess}
          onNext={flow.goNext}
        />
      )}

      {flow.step === 2 && (
        <ProjectStep
          data={flow.project}
          onChange={flow.setProject}
          onNext={flow.goNext}
          onBack={flow.goBack}
        />
      )}

      {flow.step === 3 && (
        <TeamsStep
          selectedTeams={flow.teams}
          onChange={flow.setTeams}
          onNext={flow.complete}
          onBack={flow.goBack}
        />
      )}
    </>
  );
}
