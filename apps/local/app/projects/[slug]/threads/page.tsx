"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { ThreadsListView } from "@/components/projects/ThreadsListView";
import { useThreadState } from "@/hooks/useThreadState";

export default function ProjectThreadsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const router = useRouter();
  const { threads, createThread } = useThreadState();

  return (
    <ThreadsListView
      projectSlug={slug}
      threads={threads}
      onCreateThread={async () => {
        const thread = await createThread();
        if (thread?.id) {
          router.push(`/projects/${slug}/thread/${encodeURIComponent(thread.id)}`);
        }
      }}
    />
  );
}
