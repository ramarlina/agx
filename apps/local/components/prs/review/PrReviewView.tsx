"use client";

import React, { useEffect, useState } from "react";
import type {
  GithubPr,
  GithubPrFile,
  GithubPrComment,
} from "@/lib/github-types";
import { ReviewLayout } from "./ReviewLayout";

interface DetailResponse {
  pr: GithubPr;
  files: GithubPrFile[];
  comments: GithubPrComment[];
}

interface Props {
  prId: string;
  projectId?: string;
}

export function PrReviewView({ prId, projectId }: Props) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    (async () => {
      try {
        const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
        const res = await fetch(
          `/api/github/prs/${encodeURIComponent(prId)}${qs}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as DetailResponse;
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prId, projectId]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-red-400">
        Failed to load PR: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-neutral-500">
        Loading…
      </div>
    );
  }
  return <ReviewLayout pr={data.pr} files={data.files} comments={data.comments} />;
}
