"use client";

import { useEffect, useState } from "react";
import type { Participant } from "@/lib/types";

export function useLinearParticipants(projectId?: string): {
  participants: Participant[];
  participantsLoaded: boolean;
} {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantsLoaded, setParticipantsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadParticipants() {
      try {
        const participantsResponse = await fetch("/api/participants");
        const allParticipants = participantsResponse.ok
          ? ((await participantsResponse.json()) as Participant[])
          : [];

        if (!projectId) {
          if (!cancelled) {
            setParticipants(allParticipants);
            setParticipantsLoaded(true);
          }
          return;
        }

        // Check if the linear worker has a team configured
        const workerParams = new URLSearchParams();
        workerParams.set("projectId", projectId);
        const workerResponse = await fetch(`/api/linear/worker?${workerParams}`).catch(() => null);
        const workerData = workerResponse?.ok ? await workerResponse.json().catch(() => null) : null;
        const workerTeamId: string | undefined = workerData?.job?.teamId || undefined;

        if (workerTeamId) {
          // Use the team's agents as participants
          const teamAgentsResponse = await fetch(
            `/api/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(workerTeamId)}/agents`
          );
          if (teamAgentsResponse.ok) {
            const teamData = await teamAgentsResponse.json();
            const teamAgentIds: string[] = Array.isArray(teamData.agents)
              ? teamData.agents
                  .sort((a: { routing_order?: number }, b: { routing_order?: number }) =>
                    (a.routing_order ?? 0) - (b.routing_order ?? 0)
                  )
                  .map((agent: { agent_id?: string }) => agent.agent_id)
                  .filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
              : [];
            if (teamAgentIds.length > 0) {
              const teamOrderIndex = new Map(teamAgentIds.map((id, index) => [id, index]));
              const teamParticipants = allParticipants
                .filter((participant) => teamOrderIndex.has(participant.id))
                .sort(
                  (left, right) =>
                    (teamOrderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
                    (teamOrderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER)
                );
              if (!cancelled && teamParticipants.length > 0) {
                setParticipants(teamParticipants);
                setParticipantsLoaded(true);
                return;
              }
            }
          }
        }

        // Fallback: use project agents
        const projectAgentsResponse = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/agents`
        );
        if (!projectAgentsResponse.ok) {
          if (!cancelled) {
            setParticipants(allParticipants);
            setParticipantsLoaded(true);
          }
          return;
        }

        const projectData = await projectAgentsResponse.json();
        const orderedAgentIds: string[] = Array.isArray(projectData.agents)
          ? projectData.agents
              .map((agent: { agent_id?: string }) => agent.agent_id)
              .filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
          : [];
        const orderIndex = new Map(orderedAgentIds.map((id, index) => [id, index]));
        const scopedParticipants = allParticipants
          .filter((participant) => orderIndex.has(participant.id))
          .sort(
            (left, right) =>
              (orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
              (orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER)
          );

        if (!cancelled) {
          setParticipants(scopedParticipants);
          setParticipantsLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setParticipants([]);
          setParticipantsLoaded(true);
        }
      }
    }

    void loadParticipants();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { participants, participantsLoaded };
}
