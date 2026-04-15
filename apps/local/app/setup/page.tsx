// app/setup/page.tsx
"use client";

import { useProviderStatus } from "@/hooks/useProviderStatus";
import { useSetupFlow } from "@/hooks/useSetupFlow";
import { ProviderStep } from "@/components/setup/ProviderStep";
import { McpSetupStep } from "@/components/setup/McpSetupStep";

export default function SetupPage() {
  const providerStatus = useProviderStatus();
  const flow = useSetupFlow();

  return (
    <>
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
        <McpSetupStep
          onBack={flow.goBack}
          onFinish={flow.finish}
        />
      )}
    </>
  );
}
