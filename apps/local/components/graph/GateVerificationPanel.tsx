"use client";

import { useState } from "react";
import { formatNodeStatusLabel, getNodeLabel } from "@/components/graph/graph-derived";
import type { ExecutionGraph, GateNode } from "@/src/graph/types";

interface GateVerificationPanelProps {
  taskId: string;
  graph: ExecutionGraph;
  onGraphUpdated: () => void;
}

export default function GateVerificationPanel({ taskId, graph, onGraphUpdated }: GateVerificationPanelProps) {
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});

  const gateNodes = Object.entries(graph.nodes ?? {}).filter(
    (entry): entry is [string, GateNode] =>
      entry[1]?.type === "gate" && entry[1].status === "awaiting_human"
  );

  if (gateNodes.length === 0) return null;

  async function handleVerify(nodeId: string, approved: boolean) {
    setSubmitting(nodeId);
    try {
      const res = await fetch(`/api/tasks/${taskId}/nodes/${nodeId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ifMatchGraphVersion: graph.graphVersion,
          approved,
          feedback: feedback[nodeId]?.trim() || undefined,
        }),
      });
      if (res.ok) {
        setFeedback((prev) => {
          const next = { ...prev };
          delete next[nodeId];
          return next;
        });
        onGraphUpdated();
      }
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="gate-verification-panel">
      <h3 className="gate-verification-panel__title">Gates Awaiting Verification</h3>
      {gateNodes.map(([nodeId, node]) => (
        <div key={nodeId} className="gate-verification-panel__card">
          <div className="gate-verification-panel__header">
            <span className="gate-verification-panel__label">{getNodeLabel(nodeId, node)}</span>
            <span className="gate-verification-panel__status">{formatNodeStatusLabel(node.status)}</span>
          </div>
          <div className="gate-verification-panel__meta">
            <span>Type: {node.gateType}</span>
            {node.required && <span className="gate-verification-panel__required">Required</span>}
          </div>
          {node.verificationStrategy?.checks?.length ? (
            <div className="gate-verification-panel__checks">
              <span className="gate-verification-panel__checks-label">Checks:</span>
              {node.verificationStrategy.checks.map((check) => (
                <span key={check} className="gate-verification-panel__check">{check}</span>
              ))}
            </div>
          ) : null}
          <textarea
            className="gate-verification-panel__feedback"
            placeholder="Feedback (optional)"
            value={feedback[nodeId] ?? ""}
            onChange={(e) => setFeedback((prev) => ({ ...prev, [nodeId]: e.target.value }))}
            rows={2}
          />
          <div className="gate-verification-panel__actions">
            <button
              className="gate-verification-panel__btn gate-verification-panel__btn--approve"
              disabled={submitting === nodeId}
              onClick={() => handleVerify(nodeId, true)}
            >
              {submitting === nodeId ? "Submitting…" : "Approve"}
            </button>
            <button
              className="gate-verification-panel__btn gate-verification-panel__btn--reject"
              disabled={submitting === nodeId}
              onClick={() => handleVerify(nodeId, false)}
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
