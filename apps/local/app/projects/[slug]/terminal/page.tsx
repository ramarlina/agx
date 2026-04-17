"use client";

import { Suspense } from "react";
import ProjectTerminal from "@/components/terminal/ProjectTerminal";

export default function TerminalPage() {
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <Suspense>
        <ProjectTerminal />
      </Suspense>
    </div>
  );
}
