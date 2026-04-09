"use client";
import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  X,
  User,
  Cpu,
  Box,
  BookOpen,
  Sparkles,
  Plus,
  FolderOpen,
  ChevronDown,
  GripVertical,
  Copy,
  Check,
} from 'lucide-react';
import RichTextEditor from "@/components/RichTextEditor";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Participant, ChatProvider, SkillBinding } from "@/lib/types";

const COLORS = ["#D97706", "#2563EB", "#059669", "#DC2626", "#7C3AED", "#DB2777", "#0891B2"];

export function agentAvatarUrl(seed: string, size = 32, color?: string) {
  const base = `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(seed)}&size=${size}`;
  if (!color) return base;
  const hex = color.replace("#", "");
  return `${base}&backgroundColor=${hex}`;
}

interface Props {
  participants: Participant[];
  onAdd: (p: Participant) => void;
  onUpdate: (p: Participant) => void;
  onRemove: (id: string) => void;
  activeParticipantIds?: string[];
  onToggleActive?: (participantId: string, active: boolean) => void;
  onReorder?: (orderedIds: string[]) => void;
  showInlineAdd?: boolean;
  openAddNonce?: number;
  variant?: "default" | "sidebar";
}

function SortableAgentItem({
  p,
  isActive,
  isFirst,
  onToggleActive,
  onClickEdit,
}: {
  p: Participant;
  isActive: boolean;
  isFirst: boolean;
  onToggleActive?: (participantId: string, active: boolean) => void;
  onClickEdit: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: p.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group">
      <div
        className={`w-full flex items-center justify-between gap-1 px-1.5 py-1.5 rounded-md transition-colors ${isActive ? "text-[var(--foreground)] hover:bg-[var(--muted)]" : "text-[var(--muted-foreground)] hover:bg-[var(--app-shell-subtle)]"}`}
      >
        <button
          type="button"
          className="flex-shrink-0 cursor-grab active:cursor-grabbing p-1 text-[var(--muted-foreground)] hover:text-[var(--muted-foreground)] transition-colors"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={12} />
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 flex items-center gap-2 text-left"
          onClick={onClickEdit}
        >
          <img
            src={agentAvatarUrl(p.id, 16, p.color)}
            alt=""
            className="w-4 h-4 rounded-full flex-shrink-0"
          />
          <span className="text-sm font-medium truncate">{p.name}</span>
          {isFirst && (
            <span className="text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 py-0 leading-tight flex-shrink-0">
              default
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!onToggleActive) return;
            onToggleActive(p.id, !isActive);
          }}
          aria-label={`${isActive ? "Disable" : "Enable"} ${p.name}`}
          aria-pressed={isActive}
          className={`relative w-5 h-3 rounded-full transition-colors flex-shrink-0 ${isActive ? "bg-violet-300" : "bg-[var(--muted)]"}`}
        >
          <span className={`absolute top-[2px] left-[2px] w-2 h-2 bg-[var(--card-bg)] rounded-full shadow-sm transition-transform ${isActive ? "translate-x-2" : "translate-x-0"}`} />
        </button>
      </div>
    </div>
  );
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use timeout so the current click event finishes before we start listening
    const id = setTimeout(() => document.addEventListener("mousedown", handle), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handle);
    };
  }, [ref, onClose]);
}

export interface AgentFormData {
  name: string;
  title?: string;
  provider: ChatProvider;
  model: string;
  identity: string;
  color?: string;
  skills?: { file: string; condition: string }[];
  skillBindings?: SkillBinding[];
}

export interface ProjectMembership {
  current: { id: string; name: string; is_default?: boolean }[];
  available: { id: string; name: string }[];
}

type AgentFormViewMode = "form" | "json";

const AGENT_FORM_PROVIDERS: ChatProvider[] = ["claude", "ollama", "gemini", "codex", "zai"];

function serializeSkills(skills: AgentFormData["skills"]) {
  return (skills ?? []).map((skill) => (
    skill.condition?.trim()
      ? `${skill.file} | ${skill.condition}`
      : skill.file
  )).join("\n");
}

function parseSkillsText(skillsText: string) {
  return skillsText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [file, ...conditionParts] = line.split("|");
      return {
        file: file.trim(),
        condition: conditionParts.join("|").trim(),
      };
    })
    .filter((skill) => skill.file.length > 0);
}

function buildAgentFormJson(data: AgentFormData, projectIds?: string[]) {
  return JSON.stringify(
    {
      name: data.name,
      ...(data.title ? { title: data.title } : {}),
      provider: data.provider,
      model: data.model,
      identity: data.identity,
      color: data.color ?? "#6B7280",
      skills: data.skills ?? [],
      skillBindings: data.skillBindings ?? [],
      ...(projectIds ? { projectIds } : {}),
    },
    null,
    2
  );
}

function parseAgentFormJson(raw: string, currentProvider: ChatProvider) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("JSON is invalid.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON must be an object.");
  }

  const obj = parsed as Record<string, unknown>;
  const providerValue = typeof obj.provider === "string" ? obj.provider : currentProvider;
  const provider = AGENT_FORM_PROVIDERS.includes(providerValue as ChatProvider)
    ? providerValue as ChatProvider
    : currentProvider;

  const skillsInput = Array.isArray(obj.skills) ? obj.skills : [];
  const skills = skillsInput.flatMap((entry) => {
    if (typeof entry === "string") {
      const [file, ...conditionParts] = entry.split("|");
      const trimmedFile = file.trim();
      return trimmedFile
        ? [{ file: trimmedFile, condition: conditionParts.join("|").trim() }]
        : [];
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const file = typeof entry.file === "string" ? entry.file.trim() : "";
    if (!file) return [];
    return [{
      file,
      condition: typeof entry.condition === "string" ? entry.condition.trim() : "",
    }];
  });

  const projectIds = Array.isArray(obj.projectIds)
    ? obj.projectIds.filter((projectId): projectId is string => typeof projectId === "string" && projectId.trim().length > 0)
    : undefined;
  const skillBindingsInput = Array.isArray(obj.skillBindings) ? obj.skillBindings : [];
  const skillBindings = skillBindingsInput.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const repo = typeof entry.repo === "string" ? entry.repo.trim() : "";
    const skillId = typeof entry.skillId === "string" ? entry.skillId.trim() : "";
    if (!repo || !skillId) return [];
    return [{
      repo,
      skillId,
      condition: typeof entry.condition === "string" ? entry.condition.trim() : "",
    }];
  });

  return {
    data: {
      name: typeof obj.name === "string" ? obj.name : "",
      title: typeof obj.title === "string" ? obj.title : "",
      provider,
      model: typeof obj.model === "string" ? obj.model : "",
      identity: typeof obj.identity === "string" ? obj.identity : "",
      color: typeof obj.color === "string" && obj.color.trim() ? obj.color : "#6B7280",
      skills,
      skillBindings,
    } satisfies AgentFormData,
    projectIds,
  };
}

interface InstalledSkillOption {
  id: string;
  file: string;
  repo?: string;
}

interface CatalogSkillOption {
  skillId: string;
  repo: string;
  name: string;
}

export function AgentForm({
  title: formTitle,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  projects,
  initialProjectIds,
  agentId,
  projectMemberships,
  onAddToProject,
  onRemoveFromProject,
}: {
  title: string;
  initial: AgentFormData;
  submitLabel: string;
  onSubmit: (data: AgentFormData, projectIds?: string[]) => void;
  onCancel: () => void;
  projects?: { id: string; name: string; label?: string }[];
  initialProjectIds?: string[];
  agentId?: string;
  projectMemberships?: ProjectMembership;
  onAddToProject?: (projectId: string) => void;
  onRemoveFromProject?: (projectId: string) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [title, setTitle] = useState(initial.title ?? "");
  const [provider, setProvider] = useState(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [identity, setIdentity] = useState(initial.identity);
  const [color, setColor] = useState(initial.color ?? "#6B7280");
  const [skillsText, setSkillsText] = useState(serializeSkills(initial.skills));
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set(initialProjectIds ?? []));
  const [viewMode, setViewMode] = useState<AgentFormViewMode>("form");
  const [jsonText, setJsonText] = useState(() => buildAgentFormJson(initial, projects ? (initialProjectIds ?? []) : undefined));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonCopied, setJsonCopied] = useState(false);
  const [catalogSkills, setCatalogSkills] = useState<CatalogSkillOption[]>([]);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillBindings, setSkillBindings] = useState<SkillBinding[]>(initial.skillBindings ?? []);
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(ref, onCancel);

  useEffect(() => {
    if (!skillPickerOpen) return;
    const handle = (event: MouseEvent) => {
      if (skillPickerRef.current && !skillPickerRef.current.contains(event.target as Node)) {
        setSkillPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [skillPickerOpen]);

  useEffect(() => {
    if (viewMode !== "form") return;
    setJsonText(buildAgentFormJson({
      name,
      title,
      provider,
      model,
      identity,
      color,
      skills: parseSkillsText(skillsText),
      skillBindings,
    }, projects ? Array.from(selectedProjectIds) : undefined));
  }, [viewMode, name, title, provider, model, identity, color, skillsText, skillBindings, selectedProjectIds, projects]);

  useEffect(() => {
    if (!jsonCopied) return;
    const timeoutId = window.setTimeout(() => setJsonCopied(false), 1200);
    return () => window.clearTimeout(timeoutId);
  }, [jsonCopied]);

  useEffect(() => {
    let cancelled = false;

    async function loadCatalogSkills() {
      try {
        const res = await fetch("/api/skills");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const options = Array.isArray(data.skills)
          ? data.skills
            .filter((skill: unknown): skill is { skillId?: string; repo?: string; name?: string } =>
              Boolean(skill) && typeof skill === "object"
            )
            .map((skill: { skillId?: string; repo?: string; name?: string }) => ({
              skillId: String(skill.skillId ?? "").trim(),
              repo: String(skill.repo ?? "").trim(),
              name: String(skill.name ?? skill.skillId ?? "").trim(),
            }))
            .filter((skill: CatalogSkillOption) => skill.skillId.length > 0 && skill.repo.length > 0)
          : [];
        setCatalogSkills(options);
      } catch {
        if (!cancelled) setCatalogSkills([]);
      }
    }

    void loadCatalogSkills();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyParsedJson = (raw: string) => {
    const parsed = parseAgentFormJson(raw, provider);
    const validProjectIds = projects
      ? (parsed.projectIds ?? []).filter((projectId) => projects.some((project) => project.id === projectId))
      : undefined;
    setName(parsed.data.name);
    setTitle(parsed.data.title ?? "");
    setProvider(parsed.data.provider);
    setModel(parsed.data.model);
    setIdentity(parsed.data.identity);
    setColor(parsed.data.color ?? "#6B7280");
    setSkillsText(serializeSkills(parsed.data.skills));
    setSkillBindings(parsed.data.skillBindings ?? []);
    if (projects) {
      setSelectedProjectIds(new Set(validProjectIds ?? []));
    }
    setJsonText(buildAgentFormJson(parsed.data, projects ? (validProjectIds ?? []) : undefined));
    setJsonError(null);
    return {
      ...parsed,
      projectIds: validProjectIds,
    };
  };

  const switchToFormView = () => {
    if (viewMode === "form") return;
    try {
      applyParsedJson(jsonText);
      setViewMode("form");
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "Unable to parse JSON.");
    }
  };

  const switchToJsonView = () => {
    setJsonText(buildAgentFormJson({
      name,
      title,
      provider,
      model,
      identity,
      color,
      skills: parseSkillsText(skillsText),
      skillBindings,
    }, projects ? Array.from(selectedProjectIds) : undefined));
    setJsonError(null);
    setViewMode("json");
  };

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
      setJsonCopied(true);
    } catch {
      setJsonCopied(false);
    }
  };

  const handleSubmit = () => {
    let nextName = name.trim();
    let nextTitle = title.trim();
    let nextProvider = provider;
    let nextModel = model.trim();
    let nextIdentity = identity.trim();
    let nextColor = color;
    let nextSkills = parseSkillsText(skillsText);
    let nextSkillBindings = skillBindings;
    let nextProjectIds = projects ? Array.from(selectedProjectIds) : undefined;

    if (viewMode === "json") {
      try {
        const parsed = applyParsedJson(jsonText);
        nextName = parsed.data.name.trim();
        nextTitle = (parsed.data.title ?? "").trim();
        nextProvider = parsed.data.provider;
        nextModel = parsed.data.model.trim();
        nextIdentity = parsed.data.identity.trim();
        nextColor = parsed.data.color ?? "#6B7280";
        nextSkills = parsed.data.skills ?? [];
        nextSkillBindings = parsed.data.skillBindings ?? [];
        nextProjectIds = projects ? (parsed.projectIds ?? []) : undefined;
      } catch (error) {
        setJsonError(error instanceof Error ? error.message : "Unable to parse JSON.");
        return;
      }
    }

    if (!nextName || !nextModel) return;

    onSubmit(
      {
        name: nextName,
        title: nextTitle || undefined,
        provider: nextProvider,
        model: nextModel,
        identity: nextIdentity,
        color: nextColor,
        skills: nextSkills,
        skillBindings: nextSkillBindings,
      },
      nextProjectIds
    );
  };

  const filteredCatalogSkills = useMemo(() => {
    const normalized = skillQuery.trim().toLowerCase();
    if (!normalized) return catalogSkills.slice(0, 50);
    return catalogSkills
      .filter((skill) =>
        [skill.name, skill.skillId, skill.repo].some((value) => value.toLowerCase().includes(normalized))
      )
      .slice(0, 50);
  }, [catalogSkills, skillQuery]);

  const toggleSkillBinding = (repo: string, skillId: string) => {
    setSkillBindings((prev) => (
      prev.some((binding) => binding.repo === repo && binding.skillId === skillId)
        ? prev.filter((binding) => !(binding.repo === repo && binding.skillId === skillId))
        : [...prev, { repo, skillId }]
    ));
    setSkillQuery("");
  };

  const removeSkillBinding = (repo: string, skillId: string) => {
    setSkillBindings((prev) => prev.filter((binding) => !(binding.repo === repo && binding.skillId === skillId)));
  };

  const assignedSkillKeys = useMemo(
    () => new Set(skillBindings.map((binding) => `${binding.repo}::${binding.skillId}`)),
    [skillBindings]
  );

  return (
    <div
      ref={ref}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="bg-[var(--card-bg)] rounded-[32px] shadow-2xl overflow-hidden w-full max-w-2xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in duration-300">
        <div className="px-8 pt-8 pb-4 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {agentId && (
              <div className="flex flex-col items-center gap-1.5">
                <img
                  src={agentAvatarUrl(agentId, 64, color)}
                  alt={name}
                  className="w-14 h-14 rounded-full bg-[var(--muted)]"
                />
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] text-[var(--muted-foreground)]">Color</label>
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-5 h-5 rounded border border-[var(--border)] cursor-pointer p-0"
                  />
                </div>
              </div>
            )}
            <div>
              <h2 className="text-[10px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">{formTitle}</h2>
              <h1 className="text-2xl font-semibold mt-1">{name || "Configure Agent"}</h1>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 text-[var(--muted-foreground)] hover:text-[var(--muted-foreground)] hover:bg-[var(--muted)] rounded-full transition-all"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-8 pb-8 space-y-6 overflow-y-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex rounded-xl bg-[var(--muted)] p-1">
              <button
                type="button"
                onClick={switchToFormView}
                className={viewMode === "form"
                  ? "px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--card-bg)] text-[var(--foreground)] shadow-sm"
                  : "px-3 py-1.5 text-xs font-semibold rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}
              >
                Form
              </button>
              <button
                type="button"
                onClick={switchToJsonView}
                className={viewMode === "json"
                  ? "px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--card-bg)] text-[var(--foreground)] shadow-sm"
                  : "px-3 py-1.5 text-xs font-semibold rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}
              >
                JSON
              </button>
            </div>
            {viewMode === "json" && (
              <button
                type="button"
                onClick={handleCopyJson}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] rounded-lg transition-colors"
              >
                {jsonCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                {jsonCopied ? "Copied" : "Copy"}
              </button>
            )}
          </div>

          {viewMode === "form" ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-[var(--muted-foreground)]">
                    <User size={16} /> Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-3 bg-[var(--app-shell-subtle)] border border-[var(--border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    placeholder="e.g. Ada, Kai, Sage..."
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-[var(--muted-foreground)]">
                    Title
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-4 py-3 bg-[var(--app-shell-subtle)] border border-[var(--border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    placeholder="e.g. VP of Engineering"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-[var(--muted-foreground)]">
                    <Box size={16} /> Provider
                  </label>
                  <div className="relative">
                    <select
                      value={provider}
                      onChange={(e) => setProvider(e.target.value as ChatProvider)}
                      className="w-full appearance-none px-4 py-3 bg-[var(--app-shell-subtle)] border border-[var(--border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all pr-10 cursor-pointer"
                    >
                      <option value="claude">Claude</option>
                      <option value="ollama">Ollama</option>
                      <option value="gemini">Gemini</option>
                      <option value="codex">Codex</option>
                      <option value="zai">Z.AI</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none" size={16} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-[var(--muted-foreground)]">
                    <Cpu size={16} /> Model
                  </label>
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full px-4 py-3 bg-[var(--app-shell-subtle)] border border-[var(--border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono text-sm"
                    placeholder="e.g. claude-sonnet-4-6"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-[var(--muted-foreground)]">
                  <BookOpen size={16} /> Identity
                </label>
                <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--app-shell-subtle)] focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 transition-all">
                  <RichTextEditor
                    content={identity}
                    onChange={(md) => setIdentity(md)}
                    placeholder="You are a ..."
                  />
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">Identity defines who the agent is. Keep portable knowledge separate below; project and repo knowledge belong on their scoped surfaces.</p>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-[var(--muted-foreground)]">
                  <Sparkles size={16} /> Portable Knowledge
                </label>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--app-shell-subtle)] p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-[var(--foreground)]">Skills Picker</p>
                      <p className="text-[11px] text-[var(--muted-foreground)]">Pick a skill here. AGX will install it later only if the run actually needs it.</p>
                    </div>
                  </div>
                  {catalogSkills.length > 0 ? (
                    <>
                    <div className="relative" ref={skillPickerRef}>
                      <button
                        type="button"
                        onClick={() => setSkillPickerOpen((current) => !current)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--card-bg)] text-sm font-medium hover:border-indigo-500"
                      >
                        <span className="truncate text-left">Search and add skills</span>
                        <ChevronDown size={16} className={`shrink-0 text-[var(--muted-foreground)] transition-transform ${skillPickerOpen ? "rotate-180" : ""}`} />
                      </button>
                      {skillPickerOpen && (
                        <div className="absolute left-0 right-0 top-full mt-2 z-30 rounded-xl border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] shadow-lg overflow-hidden">
                          <div className="p-2 border-b border-[var(--border)]">
                            <input
                              type="text"
                              value={skillQuery}
                              onChange={(e) => setSkillQuery(e.target.value)}
                              placeholder="Search skills"
                              className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                              autoFocus
                            />
                          </div>
                          <div className="max-h-64 overflow-y-auto">
                          {filteredCatalogSkills.length > 0 ? filteredCatalogSkills.map((skill) => {
                              const key = `${skill.repo}::${skill.skillId}`;
                              const isAdded = assignedSkillKeys.has(key);
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                                    isAdded ? "bg-emerald-50 text-[var(--foreground)]" : "text-[var(--foreground)] hover:bg-[var(--app-shell-subtle)]"
                                  }`}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => toggleSkillBinding(skill.repo, skill.skillId)}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="font-medium">{skill.name || skill.skillId}</div>
                                      <div className="text-[11px] text-[var(--muted-foreground)]">{skill.repo}</div>
                                    </div>
                                    {isAdded && (
                                      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                        Added
                                      </span>
                                    )}
                                  </div>
                                </button>
                              );
                            }) : (
                              <div className="px-3 py-3 text-sm text-[var(--muted-foreground)]">No matching skills.</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {skillBindings.map((binding) => (
                          <span
                            key={`${binding.repo}::${binding.skillId}`}
                            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 text-[11px] font-medium"
                          >
                            {binding.skillId}
                            <button
                              type="button"
                              onClick={() => removeSkillBinding(binding.repo, binding.skillId)}
                              className="text-emerald-700/70 hover:text-emerald-900"
                              title={`Remove ${binding.skillId}`}
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      {skillBindings.length === 0 && (
                        <span className="text-[11px] text-[var(--muted-foreground)]">
                          No library skills selected yet.
                        </span>
                      )}
                    </div>
                    </>
                  ) : (
                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      No catalog skills available right now.
                    </p>
                  )}
                </div>
                <textarea
                  value={skillsText}
                  onChange={(e) => setSkillsText(e.target.value)}
                  rows={5}
                  className="w-full px-4 py-3 bg-[var(--app-shell-subtle)] border border-[var(--border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono text-xs"
                  placeholder={"one/path/to/skill.md\npath/to/skill.md | when coding in TypeScript"}
                />
                <p className="text-xs text-[var(--muted-foreground)]">Portable agent knowledge only. One reference per line. Use <code>|</code> to add an optional condition.</p>
              </div>

              {projects && projects.length > 0 && (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-[var(--muted-foreground)]">
                    <FolderOpen size={16} /> Assign To Projects
                  </label>
                  <div className="space-y-1 max-h-[160px] overflow-y-auto">
                    {projects.map((project) => {
                      const checked = selectedProjectIds.has(project.id);
                      return (
                        <button
                          key={project.id}
                          type="button"
                          className={
                            checked
                              ? "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors bg-indigo-50 text-indigo-700"
                              : "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-[var(--muted-foreground)] hover:bg-[var(--app-shell-subtle)]"
                          }
                          onClick={() => setSelectedProjectIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
                            return next;
                          })}
                        >
                          <div className={
                            checked
                              ? "w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center bg-indigo-600 border-indigo-600"
                              : "w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center border-[var(--border)]"
                          }>
                            {checked && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </div>
                          <span className="text-xs font-medium text-left">{project.label ?? project.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {projectMemberships && (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-[var(--muted-foreground)]">
                    <FolderOpen size={16} /> Project Memberships
                  </label>
                  {projectMemberships.current.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {projectMemberships.current.map((project) => (
                        <div key={project.id} className="flex items-center gap-2 text-xs bg-[var(--app-shell-subtle)] rounded-lg px-3 py-2">
                          <FolderOpen size={12} className="text-[var(--muted-foreground)] shrink-0" />
                          <span className="truncate flex-1">{project.name}</span>
                          {onRemoveFromProject && !project.is_default && (
                            <button
                              type="button"
                              className="text-[var(--muted-foreground)] hover:text-red-500 transition-colors"
                              onClick={() => onRemoveFromProject(project.id)}
                              title="Remove from project"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--muted-foreground)] italic">Not assigned to any projects</p>
                  )}
                  {projectMemberships.available.length > 0 && onAddToProject && (
                    <div className="flex flex-wrap gap-1">
                      {projectMemberships.available.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-dashed border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--border)] hover:text-[var(--foreground)] transition-colors"
                          onClick={() => onAddToProject(project.id)}
                        >
                          <Plus size={10} />
                          {project.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-[var(--muted-foreground)]">Paste agent JSON here. Switching back to Form or saving will apply valid JSON to the form state.</p>
                <button
                  type="button"
                  onClick={switchToFormView}
                  className="px-3 py-1.5 text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] rounded-lg transition-colors"
                >
                  Apply to Form
                </button>
              </div>
              <textarea
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  if (jsonError) setJsonError(null);
                }}
                rows={22}
                className="w-full px-4 py-3 bg-[var(--app-shell-bg)] text-[var(--foreground)] border border-[var(--app-shell-border)] rounded-2xl focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-[var(--primary)] transition-all font-mono text-xs"
                spellCheck={false}
                autoFocus
              />
              {jsonError && (
                <p className="text-xs text-red-500">{jsonError}</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--border)]">
            <button
              onClick={onCancel}
              className="px-6 py-2.5 text-sm font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--app-shell-subtle)] rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={viewMode === "form" ? (!name.trim() || !model.trim()) : false}
              className="px-8 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl shadow-[0_4px_12px_rgba(79,70,229,0.3)] hover:bg-indigo-700 active:scale-95 disabled:opacity-50 transition-all font-bold"
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ParticipantBar({
  participants,
  onAdd,
  onUpdate,
  onRemove,
  activeParticipantIds,
  onToggleActive,
  onReorder,
  showInlineAdd = true,
  openAddNonce,
  variant = "default",
}: Props) {
  // "add" or participant id being edited, or null
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const isSidebar = variant === "sidebar";
  const activeSet = useMemo(
    () => new Set(activeParticipantIds ?? participants.map((participant) => participant.id)),
    [activeParticipantIds, participants]
  );
  const isAddPanelOpen = openPanel === "add";

  useEffect(() => {
    if (typeof openAddNonce !== "number") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenPanel("add");
  }, [openAddNonce]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorder) return;
    const oldIndex = participants.findIndex((p) => p.id === active.id);
    const newIndex = participants.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = [...participants];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    onReorder(reordered.map((p) => p.id));
  };

  const sortedParticipants = useMemo(() => {
    const active = participants.filter((p) => activeSet.has(p.id));
    const inactive = participants.filter((p) => !activeSet.has(p.id));
    return [...active, ...inactive];
  }, [participants, activeSet]);

  if (isSidebar) {
    return (
      <div className="flex flex-col gap-0.5">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortedParticipants.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            {sortedParticipants.map((p, index) => {
              const isActive = activeSet.has(p.id);
              const prevIsActive = index > 0 ? activeSet.has(sortedParticipants[index - 1].id) : null;
              const showDivider = prevIsActive === true && !isActive;
              return (
              <React.Fragment key={p.id}>
                {showDivider && (
                  <div className="mx-2 my-1 border-t border-dashed border-[var(--border)]" />
                )}
                <SortableAgentItem
                  p={p}
                  isActive={activeSet.has(p.id)}
                  isFirst={index === 0}
                  onToggleActive={onToggleActive}
                  onClickEdit={() => setOpenPanel(openPanel === p.id ? null : p.id)}
                />
                {openPanel === p.id && !isAddPanelOpen && (
                <AgentForm
                  title="Edit agent"
                    initial={{ name: p.name, provider: p.provider, model: p.model || "", identity: p.identity || "", color: p.color, skills: p.skills || [], skillBindings: p.skillBindings || [] }}
                    submitLabel="Save"
                    onSubmit={(data) => {
                      onUpdate({ id: p.id, color: data.color ?? p.color, name: data.name, provider: data.provider, model: data.model, ...(data.identity ? { identity: data.identity } : {}), skills: data.skills ?? [], skillBindings: data.skillBindings ?? [] });
                      setOpenPanel(null);
                    }}
                    onCancel={() => setOpenPanel(null)}
                  />
                )}
              </React.Fragment>
              );
            })}
          </SortableContext>
        </DndContext>

        <div className="relative">
          {showInlineAdd ? (
            <button
              type="button"
              onClick={() => {
                setOpenPanel(openPanel === "add" ? null : "add");
              }}
              className="w-full flex items-center justify-center gap-1 px-3 py-2 rounded-md text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
              Add agent
            </button>
          ) : null}
          {isAddPanelOpen && (
            <AgentForm
              title="Add agent"
              initial={{ name: "", provider: "claude", model: "", identity: "", skills: [], skillBindings: [] }}
              submitLabel="Add"
              onSubmit={(data) => {
                const color = COLORS[participants.length % COLORS.length];
                const id = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                onAdd({ id, color: data.color ?? color, name: data.name, provider: data.provider, model: data.model, ...(data.identity ? { identity: data.identity } : {}), skills: data.skills ?? [], skillBindings: data.skillBindings ?? [] });
                setOpenPanel(null);
              }}
              onCancel={() => setOpenPanel(null)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 items-center flex-wrap justify-center">
      {participants.map((p) => (
        <div key={p.id} className="relative">
          <span
            className="text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity border border-transparent hover:border-black/5 px-2.5 py-1 rounded-full flex items-center gap-1.5"
            style={{ backgroundColor: p.color + "15", color: p.color }}
            onClick={() => setOpenPanel(openPanel === p.id ? null : p.id)}
          >
            <img src={agentAvatarUrl(p.id, 16, p.color)} alt="" className="w-4 h-4 rounded-full" />
            <span>{p.name}</span>
            <span className="opacity-60 font-normal mix-blend-multiply">{p.provider}:{p.model}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(p.id); }}
              className="hover:opacity-100 opacity-60 ml-0.5 leading-none transition-opacity flex items-center justify-center"
              title={`Remove ${p.name}`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </span>

          {openPanel === p.id && (
            <AgentForm
              title="Edit agent"
              initial={{ name: p.name, provider: p.provider, model: p.model || "", identity: p.identity || "", color: p.color, skills: p.skills || [], skillBindings: p.skillBindings || [] }}
              submitLabel="Save"
              onSubmit={(data) => {
                onUpdate({ id: p.id, color: data.color ?? p.color, name: data.name, provider: data.provider, model: data.model, ...(data.identity ? { identity: data.identity } : {}), skills: data.skills ?? [], skillBindings: data.skillBindings ?? [] });
                setOpenPanel(null);
              }}
              onCancel={() => setOpenPanel(null)}
            />
          )}
        </div>
      ))}

      <div className="relative">
        <button
          onClick={() => setOpenPanel(openPanel === "add" ? null : "add")}
          className="text-xs border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--border)] hover:bg-[var(--app-shell-subtle)] transition-all font-medium flex items-center gap-1 px-2.5 py-1 rounded-full"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
          Add agent
        </button>

        {openPanel === "add" && (
          <AgentForm
            title="Add agent"
            initial={{ name: "", provider: "claude", model: "", identity: "", skills: [], skillBindings: [] }}
            submitLabel="Add"
            onSubmit={(data) => {
              const color = COLORS[participants.length % COLORS.length];
              const id = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
              onAdd({ id, color: data.color ?? color, name: data.name, provider: data.provider, model: data.model, ...(data.identity ? { identity: data.identity } : {}), skills: data.skills ?? [], skillBindings: data.skillBindings ?? [] });
              setOpenPanel(null);
            }}
            onCancel={() => setOpenPanel(null)}
          />
        )}
      </div>
    </div>
  );
}
