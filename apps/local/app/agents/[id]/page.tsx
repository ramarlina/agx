"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  Zap,
  BrainCircuit,
  ArrowLeft,
  Users,
  Hash,
  MessageSquare,
  BookOpen,
  Sparkles,
  RefreshCw,
  ChevronRight,
  Clock,
  Target,
  Cpu,
  ShieldCheck,
  CornerDownRight,
  Download,
  Pencil,
} from "lucide-react";
import type { Participant } from "@/lib/types";
import type { EnrichedProcessEntry } from "@/lib/agent-process-registry";
import { agentAvatarUrl, AgentForm, type AgentFormData } from "@/components/chat-ui/ParticipantBar";
import { useProjectsWithAgents } from "@/hooks/useProjects";
import { stripMarkers } from "@/lib/chat-utils";
import { Markdown } from "@/components/chat-ui/Markdown";

interface JournalEntry {
  t: string;
  type?: string;
  observation?: string;
  judgement?: string;
  delta?: string;
  intent?: string;
  id?: string;
  body?: string;
  selfVersion?: number;
  thread?: string;
}

interface ActivityEntry {
  t: string;
  agent?: string;
  action?: string;
  thread?: string;
  response?: string;
  messageId?: string;
  reactions?: string[];
}

interface AgentProfile {
  identity: Record<string, unknown>;
  self: string;
  selfVersion: number | null;
  selfDerivedAt: string | null;
  journal: JournalEntry[];
  activity: ActivityEntry[];
  inspectability?: {
    identity: {
      editableBySystem: boolean;
      sources: string[];
    };
    selfModel: {
      editableBySystem: boolean;
      sources: string[];
    };
    knowledge: {
      agent: {
        portableSkills: Array<{
          file: string;
          condition: string;
          source: string;
          form: string;
        }>;
        skillBindings: Array<{
          repo: string;
          skillId: string;
          condition: string;
          source: string;
          form: string;
        }>;
        learnedMemories: Array<{
          id: string;
          taskId: string;
          type: "outcome" | "decision" | "pattern" | "gotcha";
          content: string;
          createdAt: number;
          source: string;
          form: string;
        }>;
      };
    };
    evidence: {
      journalEntries: number;
      activityEvents: number;
      reactions: number;
      comments: number;
    };
  };
}

interface MessageEntry {
  threadId: string;
  id: string;
  role: string;
  content: string;
  timestamp: number;
  rootMessageId: string | null;
  threadTitle: string | null;
  prevContent: string | null;
  prevParticipantId: string | null;
}

interface AgentStats {
  total_messages: number;
  threads_participated: number;
}

export default function AgentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<Participant | null>(null);
  const [allParticipants, setAllParticipants] = useState<Participant[]>([]);
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [messages, setMessages] = useState<MessageEntry[]>([]);
  const [stats, setStats] = useState<AgentStats>({ total_messages: 0, threads_participated: 0 });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("feed");
  const [editModal, setEditModal] = useState(false);
  const [agentProcesses, setAgentProcesses] = useState<EnrichedProcessEntry[]>([]);
  const { projects } = useProjectsWithAgents();

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch("/api/participants").then((r) => r.json()),
      fetch(`/api/agents/${id}/profile`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/agents/${id}/messages`).then((r) => r.ok ? r.json() : null),
    ]).then(([participants, profileData, messagesData]) => {
      const list = Array.isArray(participants) ? participants : [];
      setAllParticipants(list);
      const found = list.find((p: Participant) => p.id === id);
      setAgent(found ?? null);
      setProfile(profileData);
      setMessages(messagesData?.messages ?? []);
      setStats(messagesData?.stats ?? { total_messages: 0, threads_participated: 0 });
      setLoading(false);
    });
  }, [id]);

  // Poll active processes for this agent
  useEffect(() => {
    if (!id) return;
    const poll = async () => {
      try {
        const res = await fetch("/api/processes?enrich=1");
        if (!res.ok) return;
        const all: EnrichedProcessEntry[] = await res.json();
        setAgentProcesses(all.filter((p) => p.agentId === id && (p.state === "spawning" || p.state === "running")));
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="animate-pulse text-[var(--muted-foreground)] text-sm">Loading agent…</div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex flex-col items-center justify-center gap-4">
        <p className="text-[var(--muted-foreground)]">Agent not found</p>
        <Link href="/agents" className="text-sm text-blue-600 hover:underline">
          Back to agents
        </Link>
      </div>
    );
  }

  const themeColor = agent.color || "#D97706";

  const agentProjects = projects.filter((t) =>
    t.agents.some((a) => a.agent_id === agent.id)
  );

  const selfModel = profile?.self || "";
  const selfModelClean: string = stripMarkers(selfModel);
  const identityFallback = agent.identity || "";
  const identityFallbackClean: string = stripMarkers(identityFallback);
  const journal = profile?.journal ?? [];
  const reflections = journal.filter((e) => e.type === "reflection");
  const inspectability = profile?.inspectability;
  const portableKnowledge = inspectability?.knowledge.agent.portableSkills ?? [];
  const boundSkills = inspectability?.knowledge.agent.skillBindings ?? [];
  const learnedKnowledge = inspectability?.knowledge.agent.learnedMemories ?? [];
  const evidenceSummary = inspectability?.evidence;

  // Flat reverse-chrono messages
  const cleanMessages = messages
    .map((m) => ({ ...m, content: stripMarkers(m.content) }))
    .filter((m) => m.content.length > 0);

  const participantMap = new Map<string, Participant>();
  for (const p of allParticipants) participantMap.set(p.id, p);

  const getParticipantName = (pid: string | null) => {
    if (!pid) return "You";
    const p = participantMap.get(pid);
    return p?.name ?? pid;
  };

  const getParticipantColor = (pid: string | null) => {
    if (!pid) return "#6366f1";
    return participantMap.get(pid)?.color ?? "#94a3b8";
  };

  const formatRelative = (ts: string | number) => {
    const date = typeof ts === "string" ? new Date(ts) : new Date(ts);
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
  };

  const formatDate = (ts: string | number) => {
    const date = typeof ts === "string" ? new Date(ts) : new Date(ts);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  };

  const statCards = [
    { label: "Messages", value: stats.total_messages.toLocaleString(), icon: MessageSquare },
    { label: "Threads", value: String(stats.threads_participated), icon: Hash },
    { label: "Journal Entries", value: String(journal.length), icon: BookOpen },
    { label: "Projects", value: String(agentProjects.length), icon: Users },
  ];

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] font-sans selection:bg-amber-100/30">
      {/* Top Nav */}
      <nav className="desktop-titlebar sticky top-0 z-50 bg-[var(--card-bg)]/80 backdrop-blur-md border-b border-[var(--border)] px-4 md:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/agents" className="p-2 hover:bg-[var(--muted)] rounded-lg transition-colors group">
            <ArrowLeft className="w-5 h-5 text-[var(--muted-foreground)] group-hover:text-[var(--foreground)]" />
          </Link>
          <div className="h-4 w-[1px] bg-[var(--muted)] hidden md:block" />
          <div className="hidden md:flex items-center gap-2 text-sm font-medium text-[var(--muted-foreground)]">
            <Users className="w-4 h-4" />
            <Link href="/agents" className="hover:text-[var(--foreground)] transition-colors">Agents</Link>
            <ChevronRight className="w-4 h-4 text-[var(--muted-foreground)]" />
            <span className="text-[var(--foreground)] font-semibold">{agent.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {profile?.selfVersion && (
            <span className="text-xs font-mono text-[var(--muted-foreground)] bg-[var(--muted)] px-2 py-1 rounded">
              v{profile.selfVersion}
            </span>
          )}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Profile Card & Sidebar */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-[var(--card-bg)] rounded-3xl border border-[var(--border)] shadow-xl shadow-black/5 overflow-hidden">
            {/* Cover */}
            <div
              className="h-32 w-full relative"
              style={{ background: `linear-gradient(135deg, ${themeColor} 0%, ${themeColor}99 100%)` }}
            >
              <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]" />
            </div>

            {/* Identity Info */}
            <div className="px-6 pb-6 text-center -mt-16 relative">
              <div className="inline-block relative">
                <img
                  alt={agent.name}
                  className="w-32 h-32 rounded-3xl bg-[var(--card-bg)] p-2 border-4 border-[var(--card-bg)] shadow-xl"
                  src={agentAvatarUrl(agent.id, 128, agent.color)}
                />
                <div className="absolute bottom-2 right-2 w-6 h-6 bg-green-500 border-4 border-[var(--card-bg)] rounded-full" />
              </div>

              <div className="mt-4 space-y-1">
                <div className="flex items-center justify-center gap-2">
                  <h1 className="text-2xl font-black tracking-tight">{agent.name}</h1>
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                    style={{ backgroundColor: `${themeColor}20`, color: themeColor }}
                  >
                    {agent.provider}
                  </span>
                </div>
                <p className="text-[var(--muted-foreground)] font-mono text-xs">{agent.model}</p>
              </div>

              {/* Quick Tags */}
              <div className="flex flex-wrap justify-center gap-2 mt-6">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--app-shell-subtle)] border border-[var(--border)] text-xs font-medium text-[var(--muted-foreground)]">
                  <Cpu className="w-3.5 h-3.5" />
                  {agent.model}
                </div>
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${agentProcesses.length > 0 ? "bg-green-50 border-green-200 text-green-700" : "bg-[var(--app-shell-subtle)] border-[var(--border)] text-[var(--muted-foreground)]"}`}>
                  <Activity className={`w-3.5 h-3.5 ${agentProcesses.length > 0 ? "animate-pulse" : ""}`} />
                  {agentProcesses.length > 0 ? "Working" : "Idle"}
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3 mt-8">
                {statCards.map((stat, i) => (
                  <div
                    key={i}
                    className="bg-[var(--app-shell-subtle)] p-3 rounded-2xl border border-[var(--border)] text-left hover:border-[var(--border)] transition-colors cursor-default"
                  >
                    <stat.icon className="w-4 h-4 text-[var(--muted-foreground)] mb-1" />
                    <div className="text-lg font-bold text-[var(--foreground)]">{stat.value}</div>
                    <div className="text-[10px] uppercase font-bold text-[var(--muted-foreground)] tracking-wider">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar Modules */}
          <div className="space-y-4">
            <div className="bg-[var(--card-bg)] rounded-2xl border border-[var(--border)] p-5">
              <h3 className="text-[11px] font-black text-[var(--muted-foreground)] uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                <Zap className="w-3.5 h-3.5" /> Actions
              </h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditModal(true)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-[var(--foreground)] bg-[var(--app-shell-subtle)] border border-[var(--border)] rounded-xl hover:bg-[var(--muted)] hover:border-[var(--border)] transition-all"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await fetch("/api/agents/export", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ agentIds: [agent.id] }),
                    });
                    if (!res.ok) return;
                    const data = await res.json();
                    const bundle = {
                      version: 1,
                      exportedAt: new Date().toISOString(),
                      agents: data.agents,
                      projects: [],
                    };
                    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${agent.name.toLowerCase().replace(/\s+/g, "-")}.agent.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-[var(--foreground)] bg-[var(--app-shell-subtle)] border border-[var(--border)] rounded-xl hover:bg-[var(--muted)] hover:border-[var(--border)] transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export
                </button>
              </div>
            </div>

            {agentProcesses.length > 0 && (
              <div className="bg-[var(--card-bg)] rounded-2xl border border-green-200 ring-1 ring-green-100 p-5">
                <h3 className="text-[11px] font-black text-green-600 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 animate-pulse" /> Working Now
                </h3>
                <div className="flex flex-col gap-2">
                  {agentProcesses.map((p) => (
                    <Link
                      key={`${p.workspaceId}-${p.threadId}`}
                      href={p.threadId ? `/thread/${p.threadId}` : "#"}
                      className="flex items-center gap-3 p-2.5 rounded-xl bg-green-50 border border-green-100 hover:border-green-300 hover:bg-green-100 transition-all group/work"
                    >
                      <div className="relative shrink-0">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-[var(--foreground)] truncate">
                          {p.threadId ? (
                            <span className="flex items-center gap-1">
                              <Hash className="w-3 h-3 text-[var(--muted-foreground)]" />
                              <span className="truncate">{p.threadTitle || p.threadId.substring(0, 12) + "..."}</span>
                            </span>
                          ) : (
                            <span>Main thread</span>
                          )}
                        </div>
                        <div className="text-[10px] text-[var(--muted-foreground)] capitalize">{p.state}</div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-[var(--muted-foreground)] group-hover/work:text-[var(--muted-foreground)]" />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {((agent.skills && agent.skills.length > 0) || (agent.skillBindings && agent.skillBindings.length > 0)) && (
              <div className="bg-[var(--card-bg)] rounded-2xl border border-[var(--border)] p-5">
                <h3 className="text-[11px] font-black text-[var(--muted-foreground)] uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                  <BrainCircuit className="w-3.5 h-3.5" /> Portable Knowledge
                </h3>
                <div className="flex flex-col gap-2">
                  {agent.skills?.map((s, i) => (
                    <div key={`skill-${i}`} className="flex items-center gap-2 text-xs p-2 hover:bg-[var(--app-shell-subtle)] rounded-lg transition-colors">
                      <Zap size={10} className="text-blue-500 shrink-0" />
                      <span className="text-blue-600 font-mono truncate" title={s.file}>
                        {s.file.split("/").pop()}
                      </span>
                      {s.condition && (
                        <span className="text-[var(--muted-foreground)] text-[10px] ml-auto shrink-0">
                          {s.condition}
                        </span>
                      )}
                    </div>
                  ))}
                  {agent.skillBindings?.map((b, i) => (
                    <div key={`binding-${i}`} className="flex items-center gap-2 text-xs p-2 hover:bg-[var(--app-shell-subtle)] rounded-lg transition-colors">
                      <BookOpen size={10} className="text-emerald-500 shrink-0" />
                      <span className="text-emerald-600 font-mono truncate" title={`${b.repo}/${b.skillId}`}>
                        {b.skillId}
                      </span>
                      {b.condition && (
                        <span className="text-[var(--muted-foreground)] text-[10px] ml-auto shrink-0">
                          {b.condition}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-[var(--card-bg)] rounded-2xl border border-[var(--border)] p-5">
              <h3 className="text-[11px] font-black text-[var(--muted-foreground)] uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5" /> Details
              </h3>
              <div className="space-y-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">ID</span>
                  <span className="font-mono bg-[var(--app-shell-subtle)] px-1.5 py-0.5 rounded">{agent.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">Provider</span>
                  <span className="font-medium capitalize">{agent.provider}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">Model</span>
                  <span className="font-mono">{agent.model}</span>
                </div>
                {profile?.identity?.voice ? (
                  <div className="flex justify-between">
                    <span className="text-[var(--muted-foreground)]">Voice</span>
                    <span className="font-medium">{String(profile.identity.voice)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between items-center">
                  <span className="text-[var(--muted-foreground)]">Color</span>
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-3 h-3 rounded-full border border-[var(--border)]"
                      style={{ backgroundColor: agent.color }}
                    />
                    <span className="font-mono">{agent.color}</span>
                  </div>
                </div>
                {profile?.selfDerivedAt && (
                  <div className="flex justify-between">
                    <span className="text-[var(--muted-foreground)]">Last Evolved</span>
                    <span className="text-[var(--muted-foreground)]">{formatRelative(profile.selfDerivedAt)}</span>
                  </div>
                )}
              </div>
            </div>

            {agentProjects.length > 0 && (
              <div className="bg-[var(--card-bg)] rounded-2xl border border-[var(--border)] p-5">
                <h3 className="text-[11px] font-black text-[var(--muted-foreground)] uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                  <Users className="w-3.5 h-3.5" /> Active Projects
                </h3>
                <div className="space-y-2">
                  {agentProjects.map((project) => (
                    <div key={project.id} className="flex items-center justify-between p-2 hover:bg-[var(--app-shell-subtle)] rounded-lg transition-colors group cursor-pointer">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[var(--muted)] flex items-center justify-center text-xs font-bold text-[var(--muted-foreground)] group-hover:bg-[var(--card-bg)] group-hover:shadow-sm">
                          {project.name[0]}
                        </div>
                        <span className="text-sm font-medium text-[var(--foreground)]">{project.name}</span>
                      </div>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {project.agents.length} agent{project.agents.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Main Content */}
        <div className="lg:col-span-8 space-y-6">
          {/* Tab Bar */}
          <div className="bg-[var(--card-bg)] p-1 rounded-2xl border border-[var(--border)] flex shadow-sm">
            {[
              { key: "inspect", label: "Inspect", icon: ShieldCheck },
              { key: "feed", label: "Feed", icon: MessageSquare },
              { key: "reflections", label: "Reflections", icon: Sparkles },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all ${
                  activeTab === tab.key
                    ? "bg-[var(--foreground)] text-[var(--background)] shadow-lg shadow-black/5"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="min-h-[600px]">
            {activeTab === "inspect" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <section className="bg-[var(--card-bg)] rounded-3xl border border-[var(--border)] p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xs font-black text-[var(--muted-foreground)] uppercase tracking-[0.2em] flex items-center gap-2">
                        <BookOpen className="w-4 h-4" /> Identity
                      </h2>
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
                        Human-authored
                      </span>
                    </div>
                    <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">
                      Canonical self-definition. The system can read this, but should not edit it.
                    </p>
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="rounded-2xl bg-[var(--app-shell-subtle)] border border-[var(--border)] p-3">
                        <div className="text-[10px] font-black uppercase tracking-wider text-[var(--muted-foreground)]">Voice</div>
                        <p className="mt-1 text-[var(--foreground)]">{String(profile?.identity?.voice ?? "Not set")}</p>
                      </div>
                      <div className="rounded-2xl bg-[var(--app-shell-subtle)] border border-[var(--border)] p-3">
                        <div className="text-[10px] font-black uppercase tracking-wider text-[var(--muted-foreground)]">Seed</div>
                        <p className="mt-1 text-[var(--foreground)]">{String(profile?.identity?.seed ?? "Not set")}</p>
                      </div>
                    </div>
                    {inspectability?.identity.sources?.length ? (
                      <div className="mt-4">
                        <div className="text-[10px] font-black uppercase tracking-wider text-[var(--muted-foreground)] mb-2">Sources</div>
                        <div className="flex flex-wrap gap-2">
                          {inspectability.identity.sources.map((source) => (
                            <span key={source} className="px-2 py-1 rounded-full bg-[var(--muted)] text-[11px] font-medium text-[var(--muted-foreground)]">
                              {source}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </section>

                  <section className="bg-[var(--card-bg)] rounded-3xl border border-amber-100 ring-1 ring-amber-200 p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xs font-black text-[var(--muted-foreground)] uppercase tracking-[0.2em] flex items-center gap-2">
                        <Sparkles className="w-4 h-4" /> Self-Model
                      </h2>
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                        System-derived
                      </span>
                    </div>
                    <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">
                      Reflective specialization model: how this agent currently understands its fit, strengths, and direction.
                    </p>
                    {selfModelClean ? (
                      <div className="mt-4 text-sm text-[var(--foreground)] leading-relaxed prose prose-sm prose-slate max-w-none">
                        <Markdown content={selfModelClean} />
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-[var(--muted-foreground)]">No self-model yet.</p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {profile?.selfVersion ? (
                        <span className="px-2 py-1 rounded-full bg-amber-50 text-[11px] font-medium text-amber-700">
                          v{profile.selfVersion}
                        </span>
                      ) : null}
                      {profile?.selfDerivedAt ? (
                        <span className="px-2 py-1 rounded-full bg-[var(--muted)] text-[11px] font-medium text-[var(--muted-foreground)]">
                          {formatRelative(profile.selfDerivedAt)}
                        </span>
                      ) : null}
                      {inspectability?.selfModel.sources?.map((source) => (
                        <span key={source} className="px-2 py-1 rounded-full bg-[var(--muted)] text-[11px] font-medium text-[var(--muted-foreground)]">
                          {source}
                        </span>
                      ))}
                    </div>
                  </section>
                </div>

                <section className="bg-[var(--card-bg)] rounded-3xl border border-[var(--border)] p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xs font-black text-[var(--muted-foreground)] uppercase tracking-[0.2em] flex items-center gap-2">
                      <BrainCircuit className="w-4 h-4" /> Agent Knowledge
                    </h2>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {portableKnowledge.length + boundSkills.length + learnedKnowledge.length} items
                    </span>
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-[10px] font-black uppercase tracking-wider text-[var(--muted-foreground)]">Portable Knowledge</div>
                        <span className="text-[10px] text-[var(--muted-foreground)]">Human-authored</span>
                      </div>
                      {portableKnowledge.length === 0 && boundSkills.length === 0 ? (
                        <p className="text-sm text-[var(--muted-foreground)]">No portable knowledge attached.</p>
                      ) : (
                        <div className="space-y-2">
                          {portableKnowledge.map((item) => (
                            <div key={`${item.file}:${item.condition}`} className="rounded-2xl border border-[var(--border)] bg-[var(--app-shell-subtle)] p-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-mono text-xs text-[var(--foreground)] truncate" title={item.file}>
                                  {item.file}
                                </span>
                                <span className="text-[10px] font-medium text-[var(--muted-foreground)] shrink-0">{item.form}</span>
                              </div>
                              {item.condition ? (
                                <p className="mt-2 text-xs text-[var(--muted-foreground)]">Use when: {item.condition}</p>
                              ) : null}
                            </div>
                          ))}
                          {boundSkills.map((item) => (
                            <div key={`${item.repo}:${item.skillId}`} className="rounded-2xl border border-[var(--border)] bg-[var(--app-shell-subtle)] p-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-mono text-xs text-[var(--foreground)] truncate" title={`${item.repo}/${item.skillId}`}>
                                  {item.skillId}
                                </span>
                                <span className="text-[10px] font-medium text-[var(--muted-foreground)] shrink-0">{item.form}</span>
                              </div>
                              <p className="mt-1 text-[10px] text-[var(--muted-foreground)] font-mono truncate" title={item.repo}>{item.repo}</p>
                              {item.condition ? (
                                <p className="mt-1 text-xs text-[var(--muted-foreground)]">Use when: {item.condition}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-[10px] font-black uppercase tracking-wider text-[var(--muted-foreground)]">Derived Knowledge Candidates</div>
                        <span className="text-[10px] text-[var(--muted-foreground)]">System-derived</span>
                      </div>
                      {learnedKnowledge.length === 0 ? (
                        <p className="text-sm text-[var(--muted-foreground)]">No extracted learnings yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {learnedKnowledge.map((item) => (
                            <div key={item.id} className="rounded-2xl border border-[var(--border)] bg-[var(--app-shell-subtle)] p-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-[10px] font-black uppercase tracking-wider text-[var(--muted-foreground)]">{item.type}</span>
                                <span className="text-[10px] text-[var(--muted-foreground)]">{formatRelative(item.createdAt)}</span>
                              </div>
                              <p className="mt-2 text-sm text-[var(--foreground)] leading-relaxed">{item.content}</p>
                              <div className="mt-2 text-[10px] text-[var(--muted-foreground)] font-mono">task {item.taskId}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <section className="bg-[var(--card-bg)] rounded-3xl border border-[var(--border)] p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xs font-black text-[var(--muted-foreground)] uppercase tracking-[0.2em] flex items-center gap-2">
                      <Activity className="w-4 h-4" /> Evidence
                    </h2>
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">
                      Non-canonical
                    </span>
                  </div>
                  <p className="text-sm text-[var(--muted-foreground)] leading-relaxed mb-4">
                    Raw and semi-structured traces that support reflection and learning. These should be inspectable, but not treated as canonical truth.
                  </p>
                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                    {[
                      { label: "Journal", value: evidenceSummary?.journalEntries ?? journal.length },
                      { label: "Activity", value: evidenceSummary?.activityEvents ?? (profile?.activity?.length ?? 0) },
                      { label: "Reactions", value: evidenceSummary?.reactions ?? 0 },
                      { label: "Comments", value: evidenceSummary?.comments ?? 0 },
                    ].map((item) => (
                      <div key={item.label} className="rounded-2xl bg-[var(--app-shell-subtle)] border border-[var(--border)] p-4">
                        <div className="text-lg font-bold text-[var(--foreground)]">{item.value}</div>
                        <div className="text-[10px] font-black uppercase tracking-wider text-[var(--muted-foreground)]">{item.label}</div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* Feed Tab: Bio + Flat Messages */}
            {activeTab === "feed" && (
              <div className="space-y-4">
                {/* Bio at top */}
                {(selfModelClean || identityFallbackClean || profile?.identity?.seed) ? (
                  <div className="bg-[var(--card-bg)] rounded-3xl border border-[var(--border)] p-6 shadow-sm">
                    {selfModelClean ? (
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <h2 className="text-xs font-black text-[var(--muted-foreground)] uppercase tracking-[0.2em] flex items-center gap-2">
                            <Target className="w-4 h-4" /> Self-Model
                          </h2>
                          {profile?.selfDerivedAt && (
                            <span className="text-[10px] text-[var(--muted-foreground)] flex items-center gap-1">
                              <RefreshCw className="w-3 h-3" />
                              v{profile.selfVersion} — {formatRelative(profile.selfDerivedAt)}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-[var(--foreground)] leading-relaxed prose prose-sm prose-slate max-w-none">
                          <Markdown content={selfModelClean} />
                        </div>
                      </div>
                    ) : identityFallbackClean ? (
                      <div>
                        <h2 className="text-xs font-black text-[var(--muted-foreground)] uppercase tracking-[0.2em] flex items-center gap-2 mb-4">
                          <Target className="w-4 h-4" /> Identity
                        </h2>
                        <div className="text-sm text-[var(--foreground)] leading-relaxed prose prose-sm prose-slate max-w-none">
                          <Markdown content={identityFallbackClean} />
                        </div>
                      </div>
                    ) : profile?.identity?.seed ? (
                      <div>
                        <h2 className="text-xs font-black text-[var(--muted-foreground)] uppercase tracking-[0.2em] flex items-center gap-2 mb-4">
                          <Target className="w-4 h-4" /> Identity Seed
                        </h2>
                        <p className="text-sm text-[var(--muted-foreground)] italic border-l-4 pl-4" style={{ borderColor: themeColor }}>
                          &ldquo;{String(profile.identity.seed)}&rdquo;
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Messages heading */}
                <div className="flex items-center justify-between px-2">
                  <h2 className="text-xs font-black text-[var(--muted-foreground)] uppercase tracking-[0.2em] flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" /> Messages
                  </h2>
                  <span className="text-xs text-[var(--muted-foreground)]">{cleanMessages.length} messages</span>
                </div>

                {cleanMessages.length === 0 ? (
                  <div className="bg-[var(--card-bg)] rounded-3xl border border-[var(--border)] p-12 text-center">
                    <MessageSquare size={32} className="mx-auto mb-3 text-[var(--muted-foreground)]" />
                    <p className="text-sm text-[var(--muted-foreground)]">No messages yet</p>
                    <p className="text-xs text-[var(--muted-foreground)] mt-1">
                      Messages will appear here as this agent participates in threads
                    </p>
                  </div>
                ) : (
                  cleanMessages.map((m) => {
                    const prevClean = m.prevContent ? stripMarkers(m.prevContent) : null;
                    const prevName = getParticipantName(m.prevParticipantId);
                    const prevColor = getParticipantColor(m.prevParticipantId);
                    const threadTitle = m.threadTitle ? stripMarkers(m.threadTitle) : null;

                    return (
                      <article
                        key={m.id}
                        className="bg-[var(--card-bg)] rounded-3xl border border-[var(--border)] p-6 hover:shadow-xl hover:shadow-black/5 transition-all group"
                      >
                        <div className="flex items-start gap-4">
                          <img
                            src={agentAvatarUrl(agent.id, 40, agent.color)}
                            alt=""
                            className="w-10 h-10 rounded-2xl shrink-0 mt-0.5 shadow-sm"
                          />
                          <div className="flex-1 min-w-0">
                            {/* Header: name + timestamp */}
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-[var(--foreground)]">{agent.name}</span>
                                <span className="text-xs text-[var(--muted-foreground)]">• {formatRelative(m.timestamp)}</span>
                              </div>
                            </div>

                            {/* Thread link */}
                            {m.rootMessageId && threadTitle && (
                              <Link
                                href={`/thread/${m.threadId}`}
                                className="inline-flex items-center gap-1.5 mb-3 px-2.5 py-1 rounded-lg bg-[var(--app-shell-subtle)] border border-[var(--border)] hover:border-[var(--border)] hover:bg-[var(--muted)] transition-colors text-[11px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] group/thread"
                              >
                                <Hash className="w-3 h-3 text-[var(--muted-foreground)] group-hover/thread:text-[var(--muted-foreground)]" />
                                <span className="truncate max-w-[300px]">{threadTitle}</span>
                                <ChevronRight className="w-3 h-3 text-[var(--muted-foreground)] group-hover/thread:text-[var(--muted-foreground)]" />
                              </Link>
                            )}

                            {/* Responding to: previous message in thread */}
                            {prevClean && (
                              <div className="mb-3 flex items-start gap-2 pl-1">
                                <CornerDownRight className="w-3.5 h-3.5 text-[var(--muted-foreground)] shrink-0 mt-1" />
                                <div className="flex-1 min-w-0 p-2.5 rounded-xl bg-[var(--app-shell-subtle)] border border-[var(--border)]">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    {m.prevParticipantId && (
                                      <img
                                        src={agentAvatarUrl(m.prevParticipantId, 16, prevColor)}
                                        alt=""
                                        className="w-4 h-4 rounded"
                                      />
                                    )}
                                    <span className="text-[10px] font-bold" style={{ color: prevColor }}>
                                      {prevName}
                                    </span>
                                  </div>
                                  <p className="text-xs text-[var(--muted-foreground)] leading-relaxed line-clamp-2">
                                    {prevClean}
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Message content */}
                            <div className="text-sm text-[var(--foreground)]">
                              <Markdown content={m.content} />
                            </div>

                            {/* Footer */}
                            <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)] font-medium">
                              <Clock className="w-3 h-3" />
                              {formatDate(m.timestamp)}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            )}

            {/* Reflections Tab */}
            {activeTab === "reflections" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                  <h2 className="text-xs font-black text-[var(--muted-foreground)] uppercase tracking-[0.2em] flex items-center gap-2">
                    <BookOpen className="w-4 h-4" /> Journal Reflections
                  </h2>
                  <span className="text-xs text-[var(--muted-foreground)]">{reflections.length} reflections</span>
                </div>

                {reflections.length === 0 ? (
                  <div className="bg-[var(--card-bg)] rounded-3xl border border-[var(--border)] p-12 text-center">
                    <Sparkles size={32} className="mx-auto mb-3 text-[var(--muted-foreground)]" />
                    <p className="text-sm text-[var(--muted-foreground)]">No reflections yet</p>
                    <p className="text-xs text-[var(--muted-foreground)] mt-1">
                      Reflections will appear as this agent evolves its self-model
                    </p>
                  </div>
                ) : (
                  reflections.map((entry, i) => {
                    const bodyContent = entry.body ? stripMarkers(entry.body) : "";
                    return (
                      <article
                        key={entry.id ?? i}
                        className="bg-[var(--card-bg)] rounded-3xl border border-amber-100 ring-1 ring-amber-200 p-6 hover:shadow-xl hover:shadow-black/5 transition-all group"
                      >
                        <div className="flex items-start gap-4">
                          <div className="relative shrink-0">
                            <img
                              alt=""
                              className="w-10 h-10 rounded-2xl shadow-sm"
                              src={agentAvatarUrl(agent.id, 40, agent.color)}
                            />
                            <div
                              className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center border-2 border-[var(--card-bg)]"
                              style={{ backgroundColor: themeColor }}
                            >
                              <Sparkles className="w-2 h-2 text-white" />
                            </div>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-[var(--foreground)]">{agent.name}</span>
                                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                                  reflection
                                </span>
                                <span className="text-xs text-[var(--muted-foreground)]">• {formatRelative(entry.t)}</span>
                              </div>
                              {entry.selfVersion && (
                                <span className="text-[10px] text-[var(--muted-foreground)] font-mono">v{entry.selfVersion}</span>
                              )}
                            </div>

                            {entry.observation && (
                              <p className="text-xs text-[var(--muted-foreground)] mb-3">{entry.observation}</p>
                            )}

                            {bodyContent && (
                              <div className="text-sm text-[var(--foreground)] leading-relaxed prose prose-sm prose-slate max-w-none">
                                <Markdown content={bodyContent} />
                              </div>
                            )}

                            {(entry.judgement || entry.delta || entry.intent) && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 pt-4 border-t border-[var(--border)] group-hover:border-[var(--border)] transition-colors">
                                {entry.judgement && (
                                  <div className="space-y-1">
                                    <div className="text-[10px] font-black text-[var(--muted-foreground)] uppercase tracking-wider">Judgment</div>
                                    <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{entry.judgement}</p>
                                  </div>
                                )}
                                {entry.delta && (
                                  <div className="space-y-1">
                                    <div className="text-[10px] font-black text-[var(--muted-foreground)] uppercase tracking-wider">Delta</div>
                                    <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{entry.delta}</p>
                                  </div>
                                )}
                                {entry.intent && (
                                  <div className="space-y-1">
                                    <div className="text-[10px] font-black text-[var(--muted-foreground)] uppercase tracking-wider">Intent</div>
                                    <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{entry.intent}</p>
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="mt-4 flex items-center justify-between">
                              <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)] font-medium">
                                <Clock className="w-3 h-3" />
                                {formatDate(entry.t)}
                              </div>
                              {entry.thread && (
                                <span className="text-[10px] text-[var(--muted-foreground)] font-mono flex items-center gap-1">
                                  <Hash className="w-3 h-3" />
                                  {entry.thread.substring(0, 12)}...
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {editModal && (
        <AgentForm
          title="Edit agent"
          initial={{
            name: agent.name,
            role: agent.role || "",
            provider: agent.provider,
            model: agent.model || "",
            identity: agent.identity || "",
            color: agent.color,
            skills: agent.skills || [],
            skillBindings: agent.skillBindings || [],
          }}
          agentId={agent.id}
          submitLabel="Save"
          onSubmit={async (data: AgentFormData) => {
            await fetch("/api/participants", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: agent.id,
                name: data.name,
                role: data.role || null,
                provider: data.provider,
                model: data.model,
                color: data.color,
                ...(data.identity ? { identity: data.identity } : {}),
                skills: data.skills ?? [],
                skillBindings: data.skillBindings ?? [],
              }),
            });
            setAgent({
              ...agent,
              name: data.name,
              role: data.role || undefined,
              provider: data.provider,
              model: data.model,
              identity: data.identity,
              color: data.color ?? agent.color,
              skills: data.skills ?? [],
              skillBindings: data.skillBindings ?? [],
            });
            setEditModal(false);
          }}
          onCancel={() => setEditModal(false)}
        />
      )}
    </div>
  );
}
