"use client";

import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import type { Participant } from "@/lib/types";

type SkillEntry = {
  rank: number;
  name: string;
  skillId: string;
  repo: string;
  installs: number;
  catalogSource?: "skills.sh" | "github";
};

type SkillDetail = {
  title: string;
  description: string;
  whenToUse: string[];
  weeklyInstalls: string;
  firstSeen: string;
  installCommand: string;
};

type SkillHistoryRow = {
  id: string;
  provider: string;
  repo: string;
  skill_id: string;
  skill_label: string;
  status: "running" | "succeeded" | "failed";
  error: string | null;
  updated_at: number;
};

const SKILL_PROVIDERS = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini" },
  { id: "zai", label: "Z.AI" },
] as const;

export default function SkillsPage() {
  const [loading, setLoading] = useState(true);
  const [busySkillId, setBusySkillId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [installed, setInstalled] = useState<string[]>([]);
  const [history, setHistory] = useState<SkillHistoryRow[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedProviders, setSelectedProviders] = useState<Record<string, string[]>>({});
  const [selectedAgentBySkill, setSelectedAgentBySkill] = useState<Record<string, string>>({});
  const [detailBySkill, setDetailBySkill] = useState<Record<string, SkillDetail | null>>({});
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null);

  async function loadAll() {
    try {
      setLoading(true);
      setError(null);
      const [skillsRes, historyRes, participantsRes] = await Promise.all([
        fetch("/api/skills"),
        fetch("/api/skills/history?limit=20"),
        fetch("/api/participants"),
      ]);

      const skillsData = skillsRes.ok ? await skillsRes.json() : { skills: [], installed: [] };
      const historyData = historyRes.ok ? await historyRes.json() : { history: [] };
      const participantsData = participantsRes.ok ? await participantsRes.json() : [];

      setSkills(skillsData.skills ?? []);
      setInstalled(skillsData.installed ?? []);
      setHistory(historyData.history ?? []);
      setParticipants(Array.isArray(participantsData) ? participantsData : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (participants.length === 0) return;
    setSelectedAgentBySkill((current) => {
      const next = { ...current };
      for (const skill of skills) {
        if (!next[skill.skillId]) next[skill.skillId] = participants[0].id;
      }
      return next;
    });
  }, [participants, skills]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return skills;
    return skills.filter((skill) =>
      [skill.name, skill.skillId, skill.repo].some((value) => value.toLowerCase().includes(normalized))
    );
  }, [query, skills]);

  const installedSet = useMemo(() => new Set(installed), [installed]);

  async function loadDetail(skill: SkillEntry) {
    if (detailBySkill[skill.skillId] !== undefined) {
      setExpandedSkillId((current) => (current === skill.skillId ? null : skill.skillId));
      return;
    }

    setExpandedSkillId(skill.skillId);
    const response = await fetch(`/api/skills/detail?source=${encodeURIComponent(skill.repo)}&skillId=${encodeURIComponent(skill.skillId)}`);
    const data = response.ok ? await response.json() : { detail: null };
    setDetailBySkill((current) => ({ ...current, [skill.skillId]: data.detail ?? null }));
  }

  async function handleInstall(skill: SkillEntry) {
    setBusySkillId(skill.skillId);
    setError(null);
    try {
      const providers = selectedProviders[skill.skillId] ?? ["codex"];
      const response = await fetch("/api/skills/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: skill.repo, skillId: skill.skillId, providers }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to install skill");
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Failed to install skill");
    } finally {
      setBusySkillId(null);
    }
  }

  async function handleRemove(skill: SkillEntry) {
    setBusySkillId(skill.skillId);
    setError(null);
    try {
      const providers = selectedProviders[skill.skillId] ?? ["codex"];
      const response = await fetch("/api/skills/unlearn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId: skill.skillId, providers }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to remove skill");
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Failed to remove skill");
    } finally {
      setBusySkillId(null);
    }
  }

  async function handleAssign(skill: SkillEntry) {
    const agentId = selectedAgentBySkill[skill.skillId];
    if (!agentId) return;
    setBusySkillId(skill.skillId);
    setError(null);
    try {
      const response = await fetch("/api/skills/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, repo: skill.repo, skillId: skill.skillId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to assign skill");
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Failed to assign skill");
    } finally {
      setBusySkillId(null);
    }
  }

  function toggleProvider(skillId: string, providerId: string) {
    setSelectedProviders((current) => {
      const existing = new Set(current[skillId] ?? ["codex"]);
      if (existing.has(providerId)) existing.delete(providerId);
      else existing.add(providerId);
      const next = Array.from(existing);
      return { ...current, [skillId]: next.length > 0 ? next : ["codex"] };
    });
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto w-full flex flex-col gap-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Skills Library</h1>
            <p className="text-sm text-[var(--muted-foreground)] mt-1">
              Browse skills from skills.sh and curated GitHub imports, install them into this workspace, then attach installed skills to AGX agents.
            </p>
          </div>
          <div className="flex gap-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search skills"
              className="w-full lg:w-80 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-2 text-sm"
            />
            <button
              onClick={() => void loadAll()}
              className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-2 text-sm font-medium hover:border-[var(--primary)]"
            >
              Refresh
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-semibold">Catalog</h2>
                <p className="text-xs text-[var(--muted-foreground)]">{filtered.length} visible skills</p>
              </div>
            </div>

            {loading ? (
              <div className="text-sm text-[var(--muted-foreground)]">Loading skills…</div>
            ) : (
              <div className="grid gap-4">
                {filtered.map((skill) => {
                  const isInstalled = installedSet.has(skill.skillId);
                  const detail = detailBySkill[skill.skillId];
                  const selected = selectedProviders[skill.skillId] ?? ["codex"];
                  const selectedAgent = selectedAgentBySkill[skill.skillId] ?? "";
                  const isBusy = busySkillId === skill.skillId;

                  return (
                    <article key={skill.skillId} className="rounded-2xl border border-[var(--card-border)] bg-[var(--background)] p-4">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold">{skill.name || skill.skillId}</h3>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${isInstalled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                              {isInstalled ? "Installed" : "Not installed"}
                            </span>
                            {skill.catalogSource === "github" && (
                              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                                GitHub
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-[var(--muted-foreground)]">{skill.repo} · {skill.skillId}</p>
                          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                            {skill.catalogSource === "github" ? "Curated GitHub import" : `skills.sh installs: ${skill.installs.toLocaleString()}`}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => void loadDetail(skill)}
                            className="rounded-xl border border-[var(--card-border)] px-3 py-2 text-xs font-medium"
                          >
                            {expandedSkillId === skill.skillId ? "Hide details" : "Details"}
                          </button>
                          {isInstalled ? (
                            <button
                              onClick={() => void handleRemove(skill)}
                              disabled={isBusy}
                              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 disabled:opacity-60"
                            >
                              {isBusy ? "Removing…" : "Remove"}
                            </button>
                          ) : (
                            <button
                              onClick={() => void handleInstall(skill)}
                              disabled={isBusy}
                              className="rounded-xl bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-60"
                            >
                              {isBusy ? "Installing…" : "Install"}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex flex-wrap gap-2">
                          {SKILL_PROVIDERS.map((provider) => (
                            <button
                              key={provider.id}
                              onClick={() => toggleProvider(skill.skillId, provider.id)}
                              className={`rounded-full border px-3 py-1 text-[11px] font-medium ${
                                selected.includes(provider.id)
                                  ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                                  : "border-[var(--card-border)] text-[var(--muted-foreground)]"
                              }`}
                            >
                              {provider.label}
                            </button>
                          ))}
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <select
                            value={selectedAgent}
                            onChange={(event) => setSelectedAgentBySkill((current) => ({ ...current, [skill.skillId]: event.target.value }))}
                            className="min-w-44 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs"
                          >
                            <option value="">Assign to agent…</option>
                            {participants.map((participant) => (
                              <option key={participant.id} value={participant.id}>
                                {participant.name} · {participant.provider}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => void handleAssign(skill)}
                            disabled={!isInstalled || !selectedAgent || isBusy}
                            className="rounded-xl border border-[var(--card-border)] px-3 py-2 text-xs font-medium disabled:opacity-50"
                          >
                            Assign to Agent
                          </button>
                        </div>
                      </div>

                      {expandedSkillId === skill.skillId && (
                        <div className="mt-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 text-sm">
                          {detail ? (
                            <div className="space-y-3">
                              {detail.description && <p>{detail.description}</p>}
                              {(detail.weeklyInstalls || detail.firstSeen) && (
                                <p className="text-xs text-[var(--muted-foreground)]">
                                  {detail.weeklyInstalls ? `Weekly installs: ${detail.weeklyInstalls}` : ""}
                                  {detail.weeklyInstalls && detail.firstSeen ? " · " : ""}
                                  {detail.firstSeen ? `First seen: ${detail.firstSeen}` : ""}
                                </p>
                              )}
                              {detail.whenToUse.length > 0 && (
                                <ul className="list-disc pl-5 text-xs text-[var(--muted-foreground)] space-y-1">
                                  {detail.whenToUse.slice(0, 4).map((item) => (
                                    <li key={item}>{item}</li>
                                  ))}
                                </ul>
                              )}
                              <code className="block overflow-x-auto rounded-lg bg-black px-3 py-2 text-xs text-white">
                                {detail.installCommand}
                              </code>
                            </div>
                          ) : (
                            <p className="text-xs text-[var(--muted-foreground)]">No detail available for this skill yet.</p>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
              <h2 className="text-lg font-semibold">Installed Here</h2>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">Project-local skills from `.agents/skills`.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {installed.length > 0 ? installed.map((skillId) => (
                  <span key={skillId} className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-medium text-emerald-700">
                    {skillId}
                  </span>
                )) : (
                  <span className="text-sm text-[var(--muted-foreground)]">No installed skills yet.</span>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
              <h2 className="text-lg font-semibold">Recent Activity</h2>
              <div className="mt-4 space-y-3">
                {history.length > 0 ? history.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-[var(--card-border)] bg-[var(--background)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{entry.skill_label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        entry.status === "succeeded" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                      }`}>
                        {entry.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">{entry.provider} · {entry.repo}</p>
                    <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{new Date(entry.updated_at).toLocaleString()}</p>
                    {entry.error && <p className="mt-2 text-xs text-red-700">{entry.error}</p>}
                  </div>
                )) : (
                  <p className="text-sm text-[var(--muted-foreground)]">No skill activity yet.</p>
                )}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </Layout>
  );
}
