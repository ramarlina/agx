import type { AgentStyle } from "./db";
import type { SkillBinding } from "./types";

export type SkillReference = SkillBinding;

export const SKILL_PROFILE_IDS = [
  "strategist-lead",
  "senior-builder",
  "builder",
  "planner",
  "researcher",
  "reviewer",
] as const;

export type SkillProfileId = (typeof SKILL_PROFILE_IDS)[number];

export const AGENT_PRESET_IDS = [
  "team-lead",
  "fullstack-engineer",
  "backend-engineer",
  "frontend-engineer",
  "qa-engineer",
  "product-manager",
  "analyst",
  "growth-marketer",
  "content-writer",
  "data-engineer",
  "ml-engineer",
  "ux-designer",
  "ui-designer",
  "devops-engineer",
  "sre",
  "security-engineer",
  "pen-tester",
  "researcher",
  "technical-writer",
  "marketing-strategist",
  "copywriter",
  "support-engineer",
  "support-lead",
  "devrel-engineer",
  "community-manager",
  "ops-engineer",
  "project-manager",
  "solutions-architect",
  "mobile-engineer",
] as const;

export type AgentPresetId = (typeof AGENT_PRESET_IDS)[number];

export const TEAM_TEMPLATE_IDS = [
  "engineering",
  "product",
  "design",
  "growth",
  "research",
  "marketing",
  "support",
  "devrel",
  "operations",
] as const;

export type TeamTemplateId = (typeof TEAM_TEMPLATE_IDS)[number];

export interface SkillProfile {
  id: SkillProfileId;
  skills: SkillReference[];
}

export interface AgentPreset {
  id: AgentPresetId;
  name: string;
  title: string;
  style: AgentStyle;
  skillProfileId: SkillProfileId;
  identity: string;
  extraSkills?: SkillReference[];
}

export interface TeamTemplateVariant {
  id: string;
  name: string;
  description: string;
  agents: AgentPreset[];
}

export interface TeamTemplate {
  id: TeamTemplateId;
  name: string;
  description: string;
  icon: string;
  agents: AgentPreset[];
  variants?: TeamTemplateVariant[];
}

export const SKILL_REPOS = {
  superpowers: "obra/superpowers",
  nextSkills: "vercel/next-skills",
} as const;

function bind(repo: string, skillId: string, condition?: string): SkillReference {
  return condition ? { repo, skillId, condition } : { repo, skillId };
}

function cloneSkillReference(binding: SkillReference): SkillReference {
  return binding.condition ? { ...binding } : { repo: binding.repo, skillId: binding.skillId };
}

function cloneSkillProfile(profile: SkillProfile): SkillProfile {
  return {
    id: profile.id,
    skills: profile.skills.map(cloneSkillReference),
  };
}

function cloneAgentPreset(agent: AgentPreset): AgentPreset {
  const clone = { ...agent };
  if (clone.extraSkills) clone.extraSkills = clone.extraSkills.map(cloneSkillReference);
  return clone;
}

function cloneVariant(v: TeamTemplateVariant): TeamTemplateVariant {
  return { ...v, agents: v.agents.map(cloneAgentPreset) };
}

function cloneTeamTemplate(template: TeamTemplate): TeamTemplate {
  const clone: TeamTemplate = {
    ...template,
    agents: template.agents.map(cloneAgentPreset),
  };
  if (clone.variants) clone.variants = clone.variants.map(cloneVariant);
  return clone;
}

// ---------------------------------------------------------------------------
// Skill profiles
// ---------------------------------------------------------------------------

const skillProfilesData: Record<SkillProfileId, SkillReference[]> = {
  "strategist-lead": [
    bind(SKILL_REPOS.superpowers, "brainstorming"),
    bind(SKILL_REPOS.superpowers, "writing-plans"),
    bind(SKILL_REPOS.superpowers, "dispatching-parallel-agents"),
    bind(SKILL_REPOS.superpowers, "requesting-code-review"),
    bind(SKILL_REPOS.superpowers, "verification-before-completion"),
  ],
  "senior-builder": [
    bind(SKILL_REPOS.superpowers, "test-driven-development"),
    bind(SKILL_REPOS.superpowers, "systematic-debugging"),
    bind(SKILL_REPOS.superpowers, "subagent-driven-development"),
    bind(SKILL_REPOS.superpowers, "requesting-code-review"),
    bind(SKILL_REPOS.superpowers, "verification-before-completion"),
    bind(SKILL_REPOS.superpowers, "finishing-a-development-branch"),
  ],
  builder: [
    bind(SKILL_REPOS.superpowers, "test-driven-development"),
    bind(SKILL_REPOS.superpowers, "systematic-debugging"),
    bind(SKILL_REPOS.superpowers, "verification-before-completion"),
    bind(SKILL_REPOS.superpowers, "finishing-a-development-branch"),
  ],
  planner: [
    bind(SKILL_REPOS.superpowers, "brainstorming"),
    bind(SKILL_REPOS.superpowers, "writing-plans"),
    bind(SKILL_REPOS.superpowers, "verification-before-completion"),
  ],
  researcher: [
    bind(SKILL_REPOS.superpowers, "brainstorming"),
    bind(SKILL_REPOS.superpowers, "writing-plans"),
    bind(SKILL_REPOS.superpowers, "systematic-debugging"),
    bind(SKILL_REPOS.superpowers, "verification-before-completion"),
  ],
  reviewer: [
    bind(SKILL_REPOS.superpowers, "systematic-debugging"),
    bind(SKILL_REPOS.superpowers, "test-driven-development"),
    bind(SKILL_REPOS.superpowers, "requesting-code-review"),
    bind(SKILL_REPOS.superpowers, "verification-before-completion"),
  ],
};

export const SKILL_PROFILES: SkillProfile[] = SKILL_PROFILE_IDS.map((id) => ({
  id,
  skills: skillProfilesData[id].map(cloneSkillReference),
}));

// ---------------------------------------------------------------------------
// Agent presets — standalone registry, referenced by team templates
// ---------------------------------------------------------------------------

const NEXT_JS_FULL: SkillReference[] = [
  bind(SKILL_REPOS.nextSkills, "api-routes", "next.js app router, route handlers, api endpoints"),
  bind(SKILL_REPOS.nextSkills, "nextjs-patterns", "next.js app structure, routing, layouts, data fetching"),
  bind(SKILL_REPOS.nextSkills, "react-server-components", "react server components, server client boundaries, next.js rendering"),
];

const NEXT_JS_UI: SkillReference[] = [
  bind(SKILL_REPOS.nextSkills, "nextjs-patterns", "next.js ui flows, routing, layouts, app router"),
  bind(SKILL_REPOS.nextSkills, "react-server-components", "react server components, server client boundaries, data fetching placement"),
];

const agentPresetsData: Record<AgentPresetId, Omit<AgentPreset, "id">> = {
  // Leadership & strategy
  "team-lead": {
    name: "Team Lead",
    title: "Team Lead",
    style: "balanced",
    skillProfileId: "strategist-lead",
    identity: "Own technical direction, break ambiguous work into executable plans, and keep the squad aligned on delivery.",
  },

  // Builders
  "fullstack-engineer": {
    name: "Fullstack Engineer",
    title: "Senior Fullstack Engineer",
    style: "balanced",
    skillProfileId: "senior-builder",
    identity: "Ship features end-to-end across frontend and backend with pragmatic tradeoffs and clean boundaries.",
    extraSkills: NEXT_JS_FULL,
  },
  "backend-engineer": {
    name: "Backend Engineer",
    title: "Senior Backend Engineer",
    style: "specialist",
    skillProfileId: "senior-builder",
    identity: "Own backend contracts, data integrity, and safe delivery under real production constraints.",
  },
  "frontend-engineer": {
    name: "Frontend Engineer",
    title: "Senior Frontend Engineer",
    style: "balanced",
    skillProfileId: "senior-builder",
    identity: "Own product-facing UI quality, interaction design fidelity, and maintainable front-end architecture.",
    extraSkills: NEXT_JS_FULL,
  },
  "data-engineer": {
    name: "Data Engineer",
    title: "Data Engineer",
    style: "specialist",
    skillProfileId: "senior-builder",
    identity: "Build reliable data pipelines, schemas, and transformations with a bias toward traceability.",
  },
  "ml-engineer": {
    name: "ML Engineer",
    title: "ML Engineer",
    style: "specialist",
    skillProfileId: "senior-builder",
    identity: "Ship model-backed systems pragmatically, with evaluation, rollback paths, and tight production feedback.",
  },
  "devops-engineer": {
    name: "DevOps Engineer",
    title: "DevOps Engineer",
    style: "specialist",
    skillProfileId: "senior-builder",
    identity: "Own delivery automation, deployment safety, and infrastructure changes that must fail predictably.",
  },
  "security-engineer": {
    name: "Security Engineer",
    title: "Security Engineer",
    style: "conservative",
    skillProfileId: "senior-builder",
    identity: "Harden trust boundaries, implement secure defaults, and turn vague risk into concrete engineering requirements.",
  },
  "ui-designer": {
    name: "UI Designer",
    title: "UI Designer",
    style: "specialist",
    skillProfileId: "builder",
    identity: "Refine interfaces into consistent, high-signal UI systems that are practical to build and maintain.",
    extraSkills: NEXT_JS_UI,
  },

  // Quality & review
  "qa-engineer": {
    name: "QA Engineer",
    title: "QA Engineer",
    style: "conservative",
    skillProfileId: "reviewer",
    identity: "Find regressions early, tighten acceptance boundaries, and force evidence before release claims.",
  },
  sre: {
    name: "SRE",
    title: "Site Reliability Engineer",
    style: "conservative",
    skillProfileId: "reviewer",
    identity: "Guard uptime, incident readiness, and operational correctness by challenging risky assumptions early.",
  },
  "pen-tester": {
    name: "Pen Tester",
    title: "Penetration Tester",
    style: "specialist",
    skillProfileId: "reviewer",
    identity: "Probe the system as an adversary, find exploit paths, and make the attack surface legible to builders.",
  },

  // Planning & research
  "product-manager": {
    name: "Product Manager",
    title: "Product Manager",
    style: "balanced",
    skillProfileId: "planner",
    identity: "Turn ambiguous requests into scoped bets, crisp plans, and explicit tradeoffs the team can execute.",
  },
  "ux-designer": {
    name: "UX Designer",
    title: "UX Designer",
    style: "balanced",
    skillProfileId: "planner",
    identity: "Clarify user intent, reduce friction in flows, and turn product goals into coherent interaction design.",
  },
  "technical-writer": {
    name: "Technical Writer",
    title: "Technical Writer",
    style: "balanced",
    skillProfileId: "planner",
    identity: "Turn complex implementation detail into clear docs, rollout notes, and operational guidance.",
  },
  "growth-marketer": {
    name: "Growth Marketer",
    title: "Growth Marketer",
    style: "balanced",
    skillProfileId: "strategist-lead",
    identity: "Design growth experiments with clear hypotheses, sequencing, and measurable outcomes.",
  },
  analyst: {
    name: "Analyst",
    title: "Product Analyst",
    style: "specialist",
    skillProfileId: "researcher",
    identity: "Ground decisions in evidence, identify gaps in the brief, and surface the signal behind user behavior.",
  },
  "content-writer": {
    name: "Content Writer",
    title: "Content Strategist",
    style: "balanced",
    skillProfileId: "researcher",
    identity: "Translate product and audience insight into clear narratives, launch copy, and feedback loops.",
  },
  researcher: {
    name: "Researcher",
    title: "Researcher",
    style: "balanced",
    skillProfileId: "researcher",
    identity: "Map fast-changing domains, synthesize evidence, and surface the governing model behind decisions.",
  },

  // Marketing & comms
  "marketing-strategist": {
    name: "Marketing Strategist",
    title: "Marketing Strategist",
    style: "balanced",
    skillProfileId: "strategist-lead",
    identity: "Own brand positioning, campaign strategy, and channel mix with measurable conversion targets.",
  },
  copywriter: {
    name: "Copywriter",
    title: "Copywriter",
    style: "balanced",
    skillProfileId: "researcher",
    identity: "Craft clear, persuasive copy that serves both the reader and the business goal.",
  },

  // Support
  "support-engineer": {
    name: "Support Engineer",
    title: "Support Engineer",
    style: "balanced",
    skillProfileId: "builder",
    identity: "Diagnose customer issues fast, escalate with precision, and turn patterns into preventive fixes.",
  },
  "support-lead": {
    name: "Support Lead",
    title: "Support Lead",
    style: "balanced",
    skillProfileId: "planner",
    identity: "Triage incoming issues, route to the right responder, and track resolution quality.",
  },

  // DevRel
  "devrel-engineer": {
    name: "DevRel Engineer",
    title: "Developer Relations Engineer",
    style: "balanced",
    skillProfileId: "senior-builder",
    identity: "Build sample apps, integrations, and tooling that make the platform easy to adopt.",
  },
  "community-manager": {
    name: "Community Manager",
    title: "Community Manager",
    style: "balanced",
    skillProfileId: "planner",
    identity: "Grow and engage the developer community through events, content, and feedback loops.",
  },

  // Operations
  "ops-engineer": {
    name: "Ops Engineer",
    title: "Operations Engineer",
    style: "specialist",
    skillProfileId: "senior-builder",
    identity: "Automate operational workflows, reduce toil, and keep internal tooling reliable.",
  },
  "project-manager": {
    name: "Project Manager",
    title: "Project Manager",
    style: "balanced",
    skillProfileId: "planner",
    identity: "Track milestones, remove blockers, and keep cross-team delivery on schedule.",
  },

  // Additional engineering presets
  "solutions-architect": {
    name: "Solutions Architect",
    title: "Solutions Architect",
    style: "balanced",
    skillProfileId: "strategist-lead",
    identity: "Design system-level architectures, evaluate tradeoffs, and guide teams through technical decisions.",
  },
  "mobile-engineer": {
    name: "Mobile Engineer",
    title: "Senior Mobile Engineer",
    style: "balanced",
    skillProfileId: "senior-builder",
    identity: "Ship native and cross-platform mobile experiences with attention to performance and platform conventions.",
  },
};

export const AGENT_PRESETS: AgentPreset[] = AGENT_PRESET_IDS.map((id) =>
  cloneAgentPreset({ id, ...agentPresetsData[id] }),
);

// ---------------------------------------------------------------------------
// Team templates — compose presets by ID, with optional specialization variants
// ---------------------------------------------------------------------------

function preset(id: AgentPresetId): AgentPreset {
  return cloneAgentPreset({ id, ...agentPresetsData[id] });
}

const teamTemplatesData: TeamTemplate[] = [
  {
    id: "engineering",
    name: "Engineering",
    description: "Software engineering teams across all domains — pick a specialization or build your own.",
    icon: "hammer",
    agents: [preset("team-lead"), preset("backend-engineer"), preset("frontend-engineer"), preset("fullstack-engineer"), preset("qa-engineer")],
    variants: [
      {
        id: "general",
        name: "General",
        description: "Product engineering with leadership, builders across the stack, and quality gates.",
        agents: [preset("team-lead"), preset("backend-engineer"), preset("frontend-engineer"), preset("fullstack-engineer"), preset("qa-engineer")],
      },
      {
        id: "ai",
        name: "AI",
        description: "Applied AI and ML engineering for models, evaluation, and production inference.",
        agents: [preset("team-lead"), preset("ml-engineer"), preset("data-engineer"), preset("researcher"), preset("qa-engineer")],
      },
      {
        id: "data",
        name: "Data",
        description: "Data platform engineering for pipelines, warehousing, and transformation reliability.",
        agents: [preset("team-lead"), preset("data-engineer"), preset("qa-engineer")],
      },
      {
        id: "mobile",
        name: "Mobile",
        description: "Native and cross-platform mobile engineering with fullstack support.",
        agents: [preset("team-lead"), preset("mobile-engineer"), preset("fullstack-engineer"), preset("qa-engineer")],
      },
      {
        id: "infra",
        name: "Infrastructure",
        description: "Platform reliability for delivery pipelines, runtime stability, and operational safety.",
        agents: [preset("team-lead"), preset("devops-engineer"), preset("sre")],
      },
      {
        id: "security",
        name: "Security",
        description: "Security engineering for secure defaults, hardening, and adversarial validation.",
        agents: [preset("team-lead"), preset("security-engineer"), preset("pen-tester")],
      },
      {
        id: "solutions",
        name: "Solutions",
        description: "Architecture and integration work across systems and customer deployments.",
        agents: [preset("team-lead"), preset("solutions-architect"), preset("backend-engineer"), preset("devops-engineer")],
      },
    ],
  },
  {
    id: "product",
    name: "Product",
    description: "Discovery and prioritization for product direction, scope, and validation.",
    icon: "clipboard-list",
    agents: [preset("team-lead"), preset("product-manager"), preset("analyst")],
  },
  {
    id: "design",
    name: "Design",
    description: "UX and UI pairing for flows, interaction models, and polished product surfaces.",
    icon: "palette",
    agents: [preset("team-lead"), preset("ux-designer"), preset("ui-designer")],
  },
  {
    id: "growth",
    name: "Growth",
    description: "Experiment and content team for acquisition, activation, and learning loops.",
    icon: "megaphone",
    agents: [preset("team-lead"), preset("growth-marketer"), preset("content-writer")],
  },
  {
    id: "research",
    name: "Research",
    description: "Research and synthesis pair for investigations, briefs, and decision support.",
    icon: "flask-conical",
    agents: [preset("team-lead"), preset("researcher"), preset("technical-writer")],
  },
  {
    id: "marketing",
    name: "Marketing",
    description: "Brand strategy, campaign execution, and content production.",
    icon: "megaphone",
    agents: [preset("team-lead"), preset("marketing-strategist"), preset("copywriter"), preset("content-writer")],
  },
  {
    id: "support",
    name: "Support",
    description: "Customer-facing support with triage, diagnosis, and escalation.",
    icon: "life-buoy",
    agents: [preset("team-lead"), preset("support-lead"), preset("support-engineer")],
  },
  {
    id: "devrel",
    name: "Developer Relations",
    description: "Developer advocacy through tooling, content, and community engagement.",
    icon: "users",
    agents: [preset("team-lead"), preset("devrel-engineer"), preset("community-manager"), preset("technical-writer")],
  },
  {
    id: "operations",
    name: "Operations",
    description: "Internal tooling, project delivery, and cross-team coordination.",
    icon: "settings",
    agents: [preset("team-lead"), preset("project-manager"), preset("ops-engineer")],
  },
];

export const TEAM_TEMPLATES: TeamTemplate[] = teamTemplatesData.map(cloneTeamTemplate);

// ---------------------------------------------------------------------------
// Lookup maps
// ---------------------------------------------------------------------------

const skillProfileMap = new Map<SkillProfileId, SkillProfile>(SKILL_PROFILES.map((profile) => [profile.id, profile]));
const agentPresetMap = new Map<AgentPresetId, AgentPreset>(AGENT_PRESETS.map((p) => [p.id, p]));
const teamTemplateMap = new Map<TeamTemplateId, TeamTemplate>(TEAM_TEMPLATES.map((template) => [template.id, template]));

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export function getSkillProfile(id: SkillProfileId | null | undefined): SkillProfile | null {
  if (!id) return null;
  const profile = skillProfileMap.get(id);
  return profile ? cloneSkillProfile(profile) : null;
}

export function getSkillProfileBindings(id: SkillProfileId | null | undefined): SkillReference[] {
  const profile = getSkillProfile(id);
  return profile ? profile.skills : [];
}

export function getAgentPreset(id: AgentPresetId | null | undefined): AgentPreset | null {
  if (!id) return null;
  const p = agentPresetMap.get(id);
  return p ? cloneAgentPreset(p) : null;
}

export function listAgentPresets(): AgentPreset[] {
  return AGENT_PRESETS.map(cloneAgentPreset);
}

export function getAgentPresetBindings(presetOrId: AgentPreset | AgentPresetId): SkillReference[] {
  const p = typeof presetOrId === "string" ? getAgentPreset(presetOrId) : presetOrId;
  if (!p) return [];
  const base = getSkillProfileBindings(p.skillProfileId);
  const extra = p.extraSkills ? p.extraSkills.map(cloneSkillReference) : [];
  return [...base, ...extra];
}

export function getTeamTemplate(id: TeamTemplateId | null | undefined): TeamTemplate | null {
  if (!id) return null;
  const template = teamTemplateMap.get(id);
  return template ? cloneTeamTemplate(template) : null;
}

export function getTemplateVariant(templateId: TeamTemplateId, variantId: string): TeamTemplateVariant | null {
  const template = getTeamTemplate(templateId);
  if (!template?.variants) return null;
  const v = template.variants.find((v) => v.id === variantId);
  return v ? cloneVariant(v) : null;
}

export function listTeamTemplates(): TeamTemplate[] {
  return TEAM_TEMPLATES.map(cloneTeamTemplate);
}
