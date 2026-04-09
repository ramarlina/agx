"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Download,
  Eye,
  Hash,
  Pencil,
  Plus,
  Share2,
  Upload,
  Users,
  X,
} from "lucide-react";
import type { Participant } from "@/lib/types";
import { useProjectsWithAgents, type ProjectWithAgents } from "@/hooks/useProjects";
import { agentAvatarUrl, AgentForm, type AgentFormData } from "@/components/chat-ui/ParticipantBar";
import type { Thread } from "@/lib/storage";
import { threadService } from "@/services/threadService";

// ── Bundle types ────────────────────────────────────────────────────────────

interface BundleAgent {
  id: string;
  name: string;
  provider: string;
  model: string | null;
  color: string;
  identity?: string | null;
  voice?: string | null;
  seed?: string | null;
  identityFile?: string | null;
  skills?: { file: string; condition: string }[];
  variables?: Record<string, string>;
  self?: string | null;
}

interface BundleProject {
  name: string;
  agentIds: string[];
}

interface AgentBundle {
  version: 1;
  exportedAt: string;
  agents: BundleAgent[];
  projects?: BundleProject[];
}

function getBundleProjects(bundle: AgentBundle | null | undefined): BundleProject[] {
  if (!bundle) return [];
  return bundle.projects ?? [];
}

const RANDOM_AGENT_NAMES = [
  "Ada", "Kai", "Sage", "Nova", "Cleo", "Milo", "Iris", "Juno",
  "Remy", "Zara", "Arlo", "Luna", "Ezra", "Wren", "Nico", "Thea",
  "Fern", "Orla", "Kira", "Dax", "Lyra", "Soren", "Vera", "Elio",
];

function randomAgentName(): string {
  return RANDOM_AGENT_NAMES[Math.floor(Math.random() * RANDOM_AGENT_NAMES.length)];
}

// ── Component ───────────────────────────────────────────────────────────────

export default function AgentLibraryPage() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const {
    projects,
    createProject,
    addAgent: addAgentToProject,
    removeAgent: removeAgentFromProject,
    refresh: refreshProjects,
  } = useProjectsWithAgents();

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [addAgentModal, setAddAgentModal] = useState<{ projectId: string } | null>(null);
  const [addAgentSelection, setAddAgentSelection] = useState<Set<string>>(new Set());
  const [creatingNewAgent, setCreatingNewAgent] = useState(false);

  // Edit agent state
  const [editAgent, setEditAgent] = useState<Participant | null>(null);

  // Outbound modal (Share = Push to Hub + Export to File)
  const [outboundModal, setOutboundModal] = useState(false);
  const [outboundAgents, setOutboundAgents] = useState<Set<string>>(new Set());
  const [outboundIncludeSelf, setOutboundIncludeSelf] = useState(true);
  const [outboundBusy, setOutboundBusy] = useState(false);
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  // Inbound modal (Import = Pull from Hub + Upload File)
  const [inboundModal, setInboundModal] = useState(false);
  const [inboundMode, setInboundMode] = useState<"choice" | "pull" | "file">("choice");
  const [pullCode, setPullCode] = useState("");
  const [pulling, setPulling] = useState(false);
  const [inboundBundle, setInboundBundle] = useState<AgentBundle | null>(null);
  const [inboundAgents, setInboundAgents] = useState<Set<string>>(new Set());
  const [inboundProjects, setInboundProjects] = useState<Set<string>>(new Set());
  const [inboundBusy, setInboundBusy] = useState(false);
  const [inboundError, setInboundError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Track which agents have active processes
  const [workingAgents, setWorkingAgents] = useState<Set<string>>(new Set());

  const refreshParticipants = () => {
    void fetch("/api/participants")
      .then((r) => r.json())
      .then((data) => setParticipants(Array.isArray(data) ? data : []));
  };

  const pollProcesses = useCallback(async () => {
    try {
      const res = await fetch("/api/processes");
      if (!res.ok) return;
      const entries: { agentId: string; state: string }[] = await res.json();
      setWorkingAgents(
        new Set(
          entries
            .filter((e) => e.state === "spawning" || e.state === "running")
            .map((e) => e.agentId)
        )
      );
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refreshParticipants();
    void threadService.listThreads().then(setThreads);
    pollProcesses();
    const id = setInterval(pollProcesses, 3000);
    return () => clearInterval(id);
  }, [pollProcesses]);

  const threadById = new Map(threads.map((t) => [t.id, t]));
  const nonDefaultProjects = projects.filter((t) => !t.is_default);

  const toggleProject = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Outbound (Share / Export) ──────────────────────────────────────

  const openOutboundModal = () => {
    setOutboundAgents(new Set(participants.map((p) => p.id)));
    setOutboundIncludeSelf(true);
    setShareCode(null);
    setShareExpiresAt(null);
    setCodeCopied(false);
    setOutboundModal(true);
  };

  const handlePushToHub = async () => {
    if (outboundAgents.size === 0) return;
    setOutboundBusy(true);
    try {
      const res = await fetch("/api/agent-specs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentIds: Array.from(outboundAgents),
          includeSelf: outboundIncludeSelf,
        }),
      });
      if (!res.ok) throw new Error("Share failed");
      const data = await res.json();
      setShareCode(data.code);
      setShareExpiresAt(data.expires_at);
    } catch (e) {
      console.error("Share error:", e);
    } finally {
      setOutboundBusy(false);
    }
  };

  const handleExportToFile = async () => {
    if (outboundAgents.size === 0) return;
    setOutboundBusy(true);
    try {
      const agentIds = Array.from(outboundAgents);
      const res = await fetch("/api/agents/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentIds }),
      });
      if (!res.ok) throw new Error("Export failed");
      const data = await res.json();

      const bundleAgents: BundleAgent[] = (data.agents as BundleAgent[]).map((a) => ({
        ...a,
        self: outboundIncludeSelf ? a.self : null,
      }));

      const bundle: AgentBundle = {
        version: 1,
        exportedAt: new Date().toISOString(),
        agents: bundleAgents,
        projects: [],
      };

      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const nameHint = bundleAgents.length === 1
        ? `${bundleAgents[0].name.toLowerCase().replace(/\s+/g, "-")}.agent.json`
        : "agents.bundle.json";
      a.download = nameHint;
      a.click();
      URL.revokeObjectURL(url);
      setOutboundModal(false);
    } catch (e) {
      console.error("Export error:", e);
    } finally {
      setOutboundBusy(false);
    }
  };

  const copyCode = () => {
    if (!shareCode) return;
    navigator.clipboard.writeText(shareCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  // ── Inbound (Pull / Upload) ─────────────────────────────────────

  const openInboundModal = () => {
    setInboundMode("choice");
    setPullCode("");
    setInboundBundle(null);
    setInboundAgents(new Set());
    setInboundProjects(new Set());
    setInboundError(null);
    setInboundModal(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setInboundError(null);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const bundle = JSON.parse(reader.result as string) as AgentBundle;
        if (!bundle.version || !Array.isArray(bundle.agents)) {
          throw new Error("Invalid bundle format");
        }
        setInboundBundle(bundle);
        setInboundAgents(new Set(bundle.agents.map((a) => a.id)));
        setInboundProjects(new Set(getBundleProjects(bundle).map((project) => project.name)));
      } catch {
        setInboundError("Invalid file. Expected an .agent.json bundle.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handlePullFetch = async () => {
    if (pullCode.trim().length === 0) return;
    setPulling(true);
    setInboundError(null);
    setInboundBundle(null);
    try {
      const res = await fetch(`/api/agent-specs/pull?code=${encodeURIComponent(pullCode.trim())}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to pull" }));
        setInboundError(data.error || "Code not found or expired");
        return;
      }
      const data = await res.json();
      const bundle = data.bundle as AgentBundle;
      setInboundBundle(bundle);
      setInboundAgents(new Set(bundle.agents.map((a) => a.id)));
      setInboundProjects(new Set(getBundleProjects(bundle).map((project) => project.name)));
    } catch {
      setInboundError("Failed to connect. Is agx-api running?");
    } finally {
      setPulling(false);
    }
  };

  const handleInboundImport = async () => {
    if (!inboundBundle) return;
    setInboundBusy(true);
    try {
      const existingIds = new Set(participants.map((p) => p.id));

      for (const agent of inboundBundle.agents) {
        if (!inboundAgents.has(agent.id)) continue;
        const payload: Record<string, unknown> = {
          name: agent.name,
          provider: agent.provider,
          model: agent.model,
          color: agent.color,
          identity: agent.identity || undefined,
          voice: agent.voice || undefined,
          seed: agent.seed || undefined,
          identityFile: agent.identityFile || undefined,
          skills: agent.skills || [],
          variables: agent.variables || {},
        };
        if (existingIds.has(agent.id)) {
          payload.id = agent.id;
          await fetch("/api/participants", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        } else {
          await fetch("/api/participants", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        }
      }

      for (const bundleProject of getBundleProjects(inboundBundle)) {
        if (!inboundProjects.has(bundleProject.name)) continue;
        const project = await createProject(bundleProject.name);
        if (project) {
          for (const agentId of bundleProject.agentIds) {
            if (inboundAgents.has(agentId)) {
              await addAgentToProject(project.id, agentId);
            }
          }
        }
      }

      refreshParticipants();
      await refreshProjects();
      setInboundModal(false);
      setInboundBundle(null);
    } catch (e) {
      console.error("Import error:", e);
      setInboundError("Import failed. Check console for details.");
    } finally {
      setInboundBusy(false);
    }
  };

  // Add agent modal helpers
  const addAgentModalProject = addAgentModal ? projects.find((t) => t.id === addAgentModal.projectId) : null;
  const addAgentModalMemberIds = new Set(addAgentModalProject?.agents.map((a) => a.agent_id) ?? []);
  const addAgentModalAvailable = addAgentModal ? participants.filter((p) => !addAgentModalMemberIds.has(p.id)) : [];

  // ── Checkbox helper ─────────────────────────────────────────────────────

  const Checkbox = ({ checked }: { checked: boolean }) => (
    <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${checked ? "bg-[var(--foreground)] border-[var(--foreground)]" : "border-[var(--app-shell-soft-text)]"}`}>
      {checked && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--secondary)] p-6">
      <div className="max-w-6xl mx-auto">
        <div className="desktop-titlebar sticky top-0 z-20 -mx-6 mb-6 flex items-center gap-3 border-b border-[var(--border)] bg-[var(--secondary)]/92 px-6 py-4 backdrop-blur-md">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--secondary-foreground)] transition-colors"
          >
            <ArrowLeft size={16} />
            Back
          </Link>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">Manage Agents</h1>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[var(--foreground)] rounded-lg hover:opacity-90 transition-colors"
              onClick={() => setCreatingNewAgent(true)}
            >
              <Plus size={13} />
              New Agent
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 transition-colors"
              onClick={openOutboundModal}
              disabled={participants.length === 0}
            >
              <Share2 size={13} />
              Share
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-600 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 transition-colors"
              onClick={openInboundModal}
            >
              <Download size={13} />
              Import
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>
        </div>

        {inboundError && !inboundModal && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center justify-between">
            <span>{inboundError}</span>
            <button type="button" onClick={() => setInboundError(null)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
          </div>
        )}

        {/* Agent Grid */}
        {participants.length === 0 ? (
          <p className="text-[var(--muted-foreground)] text-sm">No agents configured yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {participants.map((p) => (
              <div
                key={p.id}
                className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-4 hover:shadow-md transition-shadow text-left group"
              >
                <div className="flex items-start gap-3 mb-3">
                  <img
                    src={agentAvatarUrl(p.id, 48, p.color)}
                    alt={p.name}
                    className="w-12 h-12 rounded-full bg-[var(--secondary)]"
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-[var(--foreground)] truncate">{p.name}</h3>
                    <p className="text-xs text-[var(--app-shell-soft-text)] truncate mt-0.5">{p.model}</p>
                    {workingAgents.has(p.id) && (
                      <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium text-emerald-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Working
                      </span>
                    )}
                  </div>
                </div>

                {p.skills && p.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {p.skills.slice(0, 3).map((s, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 truncate max-w-[120px]"
                      >
                        {s.file.split("/").pop()}
                      </span>
                    ))}
                    {p.skills.length > 3 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--secondary)] text-[var(--app-shell-soft-text)]">
                        +{p.skills.length - 3}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--secondary)] text-[var(--muted-foreground)] uppercase tracking-wide">
                    {p.provider}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      title="Edit"
                      onClick={() => setEditAgent(p)}
                      className="p-1.5 text-[var(--app-shell-soft-text)] hover:text-[var(--muted-foreground)] rounded hover:bg-[var(--item-hover-bg)] transition-colors"
                    >
                      <Pencil size={13} />
                    </button>
                    <Link
                      href={`/agents/${p.id}`}
                      title="View profile"
                      className="p-1.5 text-[var(--app-shell-soft-text)] hover:text-[var(--muted-foreground)] rounded hover:bg-[var(--item-hover-bg)] transition-colors"
                    >
                      <Eye size={13} />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Projects Section */}
        <div className="mt-10">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Project assignments</h2>
            <p className="mt-1 text-sm text-[var(--app-shell-soft-text)]">Assign agents to existing projects.</p>
          </div>

          {nonDefaultProjects.length === 0 ? (
            <p className="text-sm text-[var(--app-shell-soft-text)]">No projects available for assignment.</p>
          ) : (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
              {nonDefaultProjects.map((project) => {
                const isExpanded = expandedProjects.has(project.id);
                const threadNames = (project.thread_ids ?? [])
                  .map((id) => threadById.get(id)?.title?.trim() || "Untitled")
                  .filter(Boolean);

                return (
                  <div key={project.id}>
                    <div className="flex items-center gap-3 px-5 py-3.5 group">
                      <button
                        type="button"
                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                        onClick={() => toggleProject(project.id)}
                      >
                        {isExpanded ? (
                          <ChevronDown size={16} className="text-[var(--app-shell-soft-text)] flex-shrink-0" />
                        ) : (
                          <ChevronRight size={16} className="text-[var(--app-shell-soft-text)] flex-shrink-0" />
                        )}
                        <Users size={16} className="text-[var(--app-shell-soft-text)] flex-shrink-0" />
                        <span className="font-medium text-[var(--foreground)] text-sm">{project.name}</span>
                        <span className="text-xs text-[var(--app-shell-soft-text)]">
                          {project.agents.length} {project.agents.length === 1 ? "agent" : "agents"}
                          {threadNames.length > 0 && ` · ${threadNames.length} ${threadNames.length === 1 ? "thread" : "threads"}`}
                        </span>
                      </button>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--item-hover-bg)] hover:text-[var(--foreground)]"
                          title="Add agents"
                          onClick={() => {
                            setAddAgentSelection(new Set());
                            setAddAgentModal({ projectId: project.id });
                          }}
                        >
                          <Plus size={14} />
                          Add agents
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-5 pb-4 pt-1 ml-9 flex flex-col gap-1">
                        {project.agents.length === 0 && (
                          <p className="text-xs text-[var(--app-shell-soft-text)] py-1">No agents in this project.</p>
                        )}
                        {project.agents.map((ta) => {
                          const agent = participants.find((p) => p.id === ta.agent_id);
                          return (
                            <div
                              key={ta.agent_id}
                              className="flex items-center gap-2.5 py-1.5 group/agent"
                            >
                              <img
                                src={agentAvatarUrl(ta.agent_id, 24, agent?.color)}
                                alt=""
                                className="w-6 h-6 rounded-full flex-shrink-0"
                              />
                              <span className="text-sm text-[var(--secondary-foreground)] truncate flex-1">
                                {agent?.name ?? ta.agent_id}
                              </span>
                              <span className="text-[10px] text-[var(--app-shell-soft-text)]">{agent?.model}</span>
                              <button
                                type="button"
                                className="opacity-0 group-hover/agent:opacity-100 text-[var(--app-shell-soft-text)] hover:text-red-500 transition-opacity"
                                onClick={() => void removeAgentFromProject(project.id, ta.agent_id)}
                                title="Remove from project"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          );
                        })}

                        <button
                          type="button"
                          className="mt-2 inline-flex items-center gap-1.5 self-start rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--item-hover-bg)] hover:text-[var(--foreground)]"
                          onClick={() => {
                            setAddAgentSelection(new Set());
                            setAddAgentModal({ projectId: project.id });
                          }}
                        >
                          <Plus size={12} />
                          Add agents
                        </button>

                        {threadNames.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-[var(--border)]">
                            <p className="text-[10px] font-medium text-[var(--app-shell-soft-text)] uppercase tracking-wide mb-1">Threads</p>
                            <div className="flex flex-wrap gap-1.5">
                              {threadNames.map((name, i) => (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-indigo-50 text-indigo-600"
                                >
                                  <Hash size={11} />
                                  {name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Outbound Modal (Share: Push to Hub / Export to File) ─────────── */}
      {outboundModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setOutboundModal(false)}
        >
          <div
            className="bg-[var(--card-bg)] rounded-xl shadow-xl border border-[var(--border)] w-[440px] max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)]">
              <h3 className="text-sm font-medium text-[var(--foreground)]">Share Agents</h3>
              <button type="button" className="text-[var(--app-shell-soft-text)] hover:text-[var(--muted-foreground)]" onClick={() => setOutboundModal(false)}>
                <X size={16} />
              </button>
            </div>

            {shareCode ? (
              <div className="px-5 py-6 flex flex-col items-center gap-4">
                <div className="text-center">
                  <p className="text-sm text-[var(--muted-foreground)] mb-3">Share this code with the recipient:</p>
                  <div className="flex items-center justify-center gap-3">
                    <span className="text-3xl font-mono font-bold tracking-[0.3em] text-[var(--foreground)]">{shareCode}</span>
                    <button type="button" className="p-2 text-[var(--app-shell-soft-text)] hover:text-[var(--muted-foreground)] transition-colors" onClick={copyCode}>
                      {codeCopied ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
                    </button>
                  </div>
                </div>
                {shareExpiresAt && (
                  <p className="text-[11px] text-[var(--app-shell-soft-text)]">Expires {new Date(shareExpiresAt).toLocaleTimeString()}</p>
                )}
                <button
                  type="button"
                  className="px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] bg-[var(--secondary)] rounded-lg hover:bg-[var(--item-hover-bg)] transition-colors"
                  onClick={() => setOutboundModal(false)}
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="overflow-y-auto flex-1">
                  {/* Projects as quick-select presets */}
                  {nonDefaultProjects.length > 0 && (
                    <div className="border-b border-[var(--border)] px-5 py-3">
                      <p className="text-[11px] font-medium text-[var(--app-shell-soft-text)] uppercase tracking-wide mb-2">Select by project</p>
                      <div className="flex flex-wrap gap-1.5">
                        {nonDefaultProjects.map((t) => {
                          const projectAgentIds = t.agents.map((a) => a.agent_id);
                          const allSelected = projectAgentIds.length > 0 && projectAgentIds.every((id) => outboundAgents.has(id));
                          const someSelected = projectAgentIds.some((id) => outboundAgents.has(id));
                          return (
                            <button
                              key={t.id}
                              type="button"
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                                allSelected
                                  ? "bg-[var(--foreground)] text-white"
                                  : someSelected
                                    ? "bg-[var(--app-shell-soft-text)] text-[var(--secondary-foreground)]"
                                    : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-[var(--item-hover-bg)]"
                              }`}
                              onClick={() => {
                                setOutboundAgents((prev) => {
                                  const next = new Set(prev);
                                  if (allSelected) {
                                    projectAgentIds.forEach((id) => next.delete(id));
                                  } else {
                                    projectAgentIds.forEach((id) => next.add(id));
                                  }
                                  return next;
                                });
                              }}
                              title={projectAgentIds.map((id) => participants.find((p) => p.id === id)?.name ?? id).join(", ")}
                            >
                              <Users size={10} />
                              {t.name}
                              <span className={`text-[10px] ${allSelected ? "text-[var(--app-shell-soft-text)]" : "text-[var(--app-shell-soft-text)]"}`}>
                                {t.agents.length}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Agents selection */}
                  <div className="border-b border-[var(--border)]">
                    <div className="px-5 pt-3 pb-1 flex items-center justify-between">
                      <p className="text-[11px] font-medium text-[var(--app-shell-soft-text)] uppercase tracking-wide">Agents</p>
                      <button
                        type="button"
                        className="text-[11px] text-[var(--app-shell-soft-text)] hover:text-[var(--muted-foreground)]"
                        onClick={() => {
                          if (outboundAgents.size === participants.length) setOutboundAgents(new Set());
                          else setOutboundAgents(new Set(participants.map((p) => p.id)));
                        }}
                      >
                        {outboundAgents.size === participants.length ? "Deselect all" : "Select all"}
                      </button>
                    </div>
                    {participants.map((p) => {
                      const selected = outboundAgents.has(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`w-full flex items-center gap-3 px-5 py-2 text-sm transition-colors ${selected ? "bg-[var(--secondary)] text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:bg-[var(--item-hover-bg)]"}`}
                          onClick={() => {
                            setOutboundAgents((prev) => {
                              const next = new Set(prev);
                              if (next.has(p.id)) next.delete(p.id);
                              else next.add(p.id);
                              return next;
                            });
                          }}
                        >
                          <Checkbox checked={selected} />
                          <img src={agentAvatarUrl(p.id, 24, p.color)} alt="" className="w-6 h-6 rounded-full flex-shrink-0" />
                          <span className="truncate text-xs font-medium flex-1">{p.name}</span>
                          <span className="text-[10px] text-[var(--app-shell-soft-text)]">{p.provider}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Options */}
                  <div className="px-5 py-3">
                    <button
                      type="button"
                      className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-colors ${outboundIncludeSelf ? "bg-[var(--secondary)] text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:bg-[var(--item-hover-bg)]"}`}
                      onClick={() => setOutboundIncludeSelf(!outboundIncludeSelf)}
                    >
                      <Checkbox checked={outboundIncludeSelf} />
                      <span className="text-xs font-medium">Include self.md (agent bio)</span>
                    </button>
                  </div>
                </div>

                <div className="px-5 py-3 border-t border-[var(--border)] flex items-center justify-between">
                  <span className="text-[11px] text-[var(--app-shell-soft-text)]">
                    {outboundAgents.size} {outboundAgents.size === 1 ? "agent" : "agents"}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={outboundAgents.size === 0 || outboundBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] bg-[var(--card-bg)] border border-[var(--border)] rounded-lg hover:bg-[var(--item-hover-bg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      onClick={() => void handleExportToFile()}
                    >
                      <Download size={12} />
                      {outboundBusy ? "Exporting..." : "Export to File"}
                    </button>
                    <button
                      type="button"
                      disabled={outboundAgents.size === 0 || outboundBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      onClick={() => void handlePushToHub()}
                    >
                      <Share2 size={12} />
                      {outboundBusy ? "Pushing..." : "Push to Hub"}
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--secondary-foreground)] transition-colors"
                      onClick={() => setOutboundModal(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Add Agent to Project Modal ────────────────────────────────────── */}
      {addAgentModal && !creatingNewAgent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setAddAgentModal(null)}
        >
          <div
            className="bg-[var(--card-bg)] rounded-xl shadow-xl border border-[var(--border)] w-80 max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-sm font-medium text-[var(--foreground)]">Add to {addAgentModalProject?.name ?? "project"}</h3>
              <button type="button" className="text-[var(--app-shell-soft-text)] hover:text-[var(--muted-foreground)]" onClick={() => setAddAgentModal(null)}><X size={16} /></button>
            </div>
            <div className="overflow-y-auto py-1 flex-1">
              <button
                type="button"
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--secondary-foreground)] hover:bg-[var(--item-hover-bg)] transition-colors border-b border-[var(--border)]"
                onClick={() => setCreatingNewAgent(true)}
              >
                <Plus size={14} className="text-[var(--app-shell-soft-text)]" />
                <span className="text-xs font-medium">Create new agent</span>
              </button>
              {addAgentModalAvailable.length === 0 ? (
                <p className="px-4 py-6 text-xs text-[var(--app-shell-soft-text)] text-center">All agents are already in this project</p>
              ) : (
                addAgentModalAvailable.map((p) => {
                  const selected = addAgentSelection.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${selected ? "bg-[var(--secondary)] text-[var(--foreground)]" : "text-[var(--secondary-foreground)] hover:bg-[var(--item-hover-bg)]"}`}
                      onClick={() => {
                        setAddAgentSelection((prev) => {
                          const next = new Set(prev);
                          if (next.has(p.id)) next.delete(p.id);
                          else next.add(p.id);
                          return next;
                        });
                      }}
                    >
                      <Checkbox checked={selected} />
                      <img src={agentAvatarUrl(p.id, 24, p.color)} alt="" className="w-6 h-6 rounded-full flex-shrink-0" />
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate font-medium text-xs">{p.name}</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            {addAgentModalAvailable.length > 0 && (
              <div className="px-4 py-3 border-t border-[var(--border)] flex justify-end gap-2">
                <button type="button" className="px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--secondary-foreground)] transition-colors" onClick={() => setAddAgentModal(null)}>Cancel</button>
                <button
                  type="button"
                  disabled={addAgentSelection.size === 0}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-[var(--foreground)] rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  onClick={() => {
                    for (const agentId of addAgentSelection) {
                      void addAgentToProject(addAgentModal.projectId, agentId);
                    }
                    setAddAgentModal(null);
                  }}
                >
                  Add {addAgentSelection.size > 0 ? `(${addAgentSelection.size})` : ""}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Create New Agent Modal (AgentForm) ────────────────────────────── */}
      {creatingNewAgent && (
        <AgentForm
          title="Create new agent"
          initial={{ name: randomAgentName(), provider: "claude", model: "", identity: "", skills: [], skillBindings: [] }}
          submitLabel="Create"
          projects={nonDefaultProjects.map((project) => {
            const threadName = (project.thread_ids ?? []).map((threadId) => threadById.get(threadId)?.title?.trim()).filter(Boolean).join(", ") || "No thread";
            return { id: project.id, name: project.name, label: `${threadName} › ${project.name}` };
          })}
          initialProjectIds={addAgentModal ? [addAgentModal.projectId] : []}
          onSubmit={async (data: AgentFormData, projectIds?: string[]) => {
            const colors = ["#D97706", "#2563EB", "#059669", "#DC2626", "#7C3AED", "#DB2777", "#0891B2"];
            const color = colors[participants.length % colors.length];
            const id = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            const firstProjectId = projectIds?.[0];
            const res = await fetch("/api/participants", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id, name: data.name, provider: data.provider, model: data.model, color: data.color ?? color,
                ...(data.title ? { title: data.title } : {}),
                ...(data.identity ? { identity: data.identity } : {}),
                skills: data.skills ?? [],
                skillBindings: data.skillBindings ?? [],
                ...(firstProjectId ? { projectId: firstProjectId } : {}),
              }),
            });
            if (res.ok) {
              const createdAgent = await res.json().catch(() => ({}));
              const createdAgentId = typeof createdAgent?.id === "string" && createdAgent.id.trim()
                ? createdAgent.id.trim()
                : id;
              for (const tid of (projectIds ?? []).slice(1)) {
                await addAgentToProject(tid, createdAgentId);
              }
              setCreatingNewAgent(false);
              setAddAgentModal(null);
              refreshParticipants();
              refreshProjects();
            }
          }}
          onCancel={() => { setCreatingNewAgent(false); }}
        />
      )}

      {/* ── Edit Agent Modal ──────────────────────────────────────────────── */}
      {editAgent && (
        <AgentForm
          title="Edit agent"
          initial={{
            name: editAgent.name,
            title: editAgent.title || "",
            provider: editAgent.provider,
            model: editAgent.model || "",
            identity: editAgent.identity || "",
            color: editAgent.color,
            skills: editAgent.skills || [],
            skillBindings: editAgent.skillBindings || [],
          }}
          agentId={editAgent.id}
          submitLabel="Save"
          projectMemberships={{
            current: projects
              .filter((project) => project.agents.some((agent) => agent.agent_id === editAgent.id))
              .map((project) => ({ id: project.id, name: project.name, is_default: !!project.is_default })),
            available: projects
              .filter((project) => !project.agents.some((agent) => agent.agent_id === editAgent.id))
              .map((project) => ({ id: project.id, name: project.name })),
          }}
          onAddToProject={(projectId) => addAgentToProject(projectId, editAgent.id)}
          onRemoveFromProject={(projectId) => removeAgentFromProject(projectId, editAgent.id)}
          onSubmit={async (data: AgentFormData) => {
            await fetch("/api/participants", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: editAgent.id,
                name: data.name,
                title: data.title || null,
                provider: data.provider,
                model: data.model,
                color: data.color,
                ...(data.identity ? { identity: data.identity } : {}),
                skills: data.skills ?? [],
                skillBindings: data.skillBindings ?? [],
              }),
            });
            setEditAgent(null);
            refreshParticipants();
          }}
          onCancel={() => setEditAgent(null)}
        />
      )}

      {/* ── Inbound Modal (Import: Pull from Hub / Upload File) ────────── */}
      {inboundModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setInboundModal(false)}
        >
          <div
            className="bg-[var(--card-bg)] rounded-xl shadow-xl border border-[var(--border)] w-[440px] max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)]">
              <h3 className="text-sm font-medium text-[var(--foreground)]">Import Agents</h3>
              <button type="button" className="text-[var(--app-shell-soft-text)] hover:text-[var(--muted-foreground)]" onClick={() => setInboundModal(false)}>
                <X size={16} />
              </button>
            </div>

            {inboundMode === "choice" && !inboundBundle && (
              /* ── Choose source ── */
              <div className="px-5 py-6 flex flex-col gap-3">
                <button
                  type="button"
                  className="flex items-center gap-3 px-4 py-3.5 rounded-lg border border-[var(--border)] hover:border-violet-300 hover:bg-violet-50 transition-colors text-left"
                  onClick={() => setInboundMode("pull")}
                >
                  <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                    <Download size={16} className="text-violet-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--foreground)]">Pull from Hub</p>
                    <p className="text-[11px] text-[var(--app-shell-soft-text)]">Enter a share code to import agents</p>
                  </div>
                </button>
                <button
                  type="button"
                  className="flex items-center gap-3 px-4 py-3.5 rounded-lg border border-[var(--border)] hover:border-[var(--border)] hover:bg-[var(--item-hover-bg)] transition-colors text-left"
                  onClick={() => {
                    setInboundMode("file");
                    setTimeout(() => fileInputRef.current?.click(), 100);
                  }}
                >
                  <div className="w-9 h-9 rounded-lg bg-[var(--secondary)] flex items-center justify-center flex-shrink-0">
                    <Upload size={16} className="text-[var(--muted-foreground)]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--foreground)]">Upload File</p>
                    <p className="text-[11px] text-[var(--app-shell-soft-text)]">Import from a .agent.json bundle</p>
                  </div>
                </button>
              </div>
            )}

            {inboundMode === "pull" && !inboundBundle && (
              /* ── Enter code ── */
              <div className="px-5 py-5 flex flex-col gap-3">
                <label className="text-sm text-[var(--muted-foreground)]">Enter share code:</label>
                <input
                  autoFocus
                  type="text"
                  value={pullCode}
                  onChange={(e) => setPullCode(e.target.value.toUpperCase())}
                  placeholder="e.g. A3X9K2"
                  maxLength={6}
                  className="w-full px-3 py-2.5 text-center text-2xl font-mono font-bold tracking-[0.3em] border border-[var(--border)] rounded-lg outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200 transition-all bg-[var(--card-bg)] text-[var(--foreground)]"
                  onKeyDown={(e) => { if (e.key === "Enter") void handlePullFetch(); }}
                />
                {inboundError && (
                  <p className="text-xs text-red-500">{inboundError}</p>
                )}
                <div className="flex justify-end gap-2 mt-1">
                  <button type="button" className="px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--secondary-foreground)] transition-colors" onClick={() => { setInboundMode("choice"); setInboundError(null); }}>
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={pullCode.trim().length === 0 || pulling}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    onClick={() => void handlePullFetch()}
                  >
                    {pulling ? "Fetching..." : "Fetch"}
                  </button>
                </div>
              </div>
            )}

            {inboundMode === "file" && !inboundBundle && (
              /* ── Waiting for file ── */
              <div className="px-5 py-6 flex flex-col items-center gap-3">
                <p className="text-sm text-[var(--muted-foreground)]">Select a .agent.json file to import</p>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] bg-[var(--secondary)] rounded-lg hover:bg-[var(--item-hover-bg)] transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={13} />
                  Choose File
                </button>
                {inboundError && (
                  <p className="text-xs text-red-500">{inboundError}</p>
                )}
                <button type="button" className="text-xs text-[var(--app-shell-soft-text)] hover:text-[var(--muted-foreground)] mt-1" onClick={() => { setInboundMode("choice"); setInboundError(null); }}>
                  Back
                </button>
              </div>
            )}

            {inboundBundle && (
              /* ── Preview & select agents to import ── */
              <>
                <div className="overflow-y-auto flex-1">
                  {/* Bundle info */}
                  {inboundBundle.exportedAt && (
                    <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--secondary)]">
                      <p className="text-[11px] text-[var(--app-shell-soft-text)]">
                        Exported {new Date(inboundBundle.exportedAt).toLocaleDateString()} · {inboundBundle.agents.length} agents{getBundleProjects(inboundBundle).length > 0 ? `, ${getBundleProjects(inboundBundle).length} projects` : ""}
                      </p>
                    </div>
                  )}

                  {/* Agents */}
                  <div className="border-b border-[var(--border)]">
                    <div className="px-5 pt-3 pb-1 flex items-center justify-between">
                      <p className="text-[11px] font-medium text-[var(--app-shell-soft-text)] uppercase tracking-wide">
                        {inboundBundle.agents.length} agent{inboundBundle.agents.length === 1 ? "" : "s"} found
                      </p>
                      <button
                        type="button"
                        className="text-[11px] text-[var(--app-shell-soft-text)] hover:text-[var(--muted-foreground)]"
                        onClick={() => {
                          if (inboundAgents.size === inboundBundle.agents.length) setInboundAgents(new Set());
                          else setInboundAgents(new Set(inboundBundle.agents.map((a) => a.id)));
                        }}
                      >
                        {inboundAgents.size === inboundBundle.agents.length ? "Deselect all" : "Select all"}
                      </button>
                    </div>
                    {inboundBundle.agents.map((a) => {
                      const selected = inboundAgents.has(a.id);
                      const existing = participants.find((p) => p.id === a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${selected ? "bg-[var(--secondary)] text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:bg-[var(--item-hover-bg)]"}`}
                          onClick={() => {
                            setInboundAgents((prev) => {
                              const next = new Set(prev);
                              if (next.has(a.id)) next.delete(a.id);
                              else next.add(a.id);
                              return next;
                            });
                          }}
                        >
                          <Checkbox checked={selected} />
                          <img src={agentAvatarUrl(a.id, 24, a.color)} alt="" className="w-6 h-6 rounded-full flex-shrink-0" />
                          <div className="min-w-0 flex-1 text-left">
                            <div className="truncate text-xs font-medium">{a.name}</div>
                            <div className="truncate text-[10px] text-[var(--app-shell-soft-text)]">{a.provider}{a.model ? ` · ${a.model}` : ""}</div>
                          </div>
                          {existing && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 flex-shrink-0">
                              update
                            </span>
                          )}
                          {!existing && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-600 flex-shrink-0">
                              new
                            </span>
                          )}
                          {a.self && (
                            <span className="text-[10px] text-[var(--muted-foreground)] flex-shrink-0">+ self.md</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Projects */}
                  {getBundleProjects(inboundBundle).length > 0 && (
                    <div>
                      <div className="px-5 pt-3 pb-1">
                        <p className="text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide">Projects</p>
                      </div>
                      {getBundleProjects(inboundBundle).map((project) => {
                        const selected = inboundProjects.has(project.name);
                        return (
                          <button
                            key={project.name}
                            type="button"
                            className={`w-full flex items-center gap-3 px-5 py-2 text-sm transition-colors ${selected ? "bg-[var(--app-shell-subtle)] text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:bg-[var(--app-shell-subtle)]"}`}
                            onClick={() => {
                              setInboundProjects((prev) => {
                                const next = new Set(prev);
                                if (next.has(project.name)) next.delete(project.name);
                                else next.add(project.name);
                                return next;
                              });
                            }}
                          >
                            <Checkbox checked={selected} />
                            <Users size={14} className="text-[var(--muted-foreground)] flex-shrink-0" />
                            <span className="truncate text-xs font-medium flex-1">{project.name}</span>
                            <span className="text-[10px] text-[var(--muted-foreground)]">{project.agentIds.length} agents</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {inboundError && (
                  <div className="px-5 py-2">
                    <p className="text-xs text-red-500">{inboundError}</p>
                  </div>
                )}

                <div className="px-5 py-3 border-t border-[var(--border)] flex items-center justify-between">
                  <span className="text-[11px] text-[var(--muted-foreground)]">
                    {inboundAgents.size} {inboundAgents.size === 1 ? "agent" : "agents"}{inboundProjects.size > 0 ? `, ${inboundProjects.size} ${inboundProjects.size === 1 ? "project" : "projects"}` : ""}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                      onClick={() => { setInboundBundle(null); setInboundAgents(new Set()); setInboundProjects(new Set()); }}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      disabled={inboundAgents.size === 0 || inboundBusy}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      onClick={() => void handleInboundImport()}
                    >
                      <Upload size={12} />
                      {inboundBusy ? "Importing..." : `Import ${inboundAgents.size} agent${inboundAgents.size === 1 ? "" : "s"}`}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
