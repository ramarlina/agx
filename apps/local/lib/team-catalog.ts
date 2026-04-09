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

export const TEAM_TEMPLATE_IDS = [
  "engineering",
  "product",
  "growth",
  "data",
  "design",
  "infra",
  "security",
  "research",
] as const;

export type TeamTemplateId = (typeof TEAM_TEMPLATE_IDS)[number];

export interface SkillProfile {
  id: SkillProfileId;
  skills: SkillReference[];
}

export interface AgentPreset {
  roleKey: string;
  name: string;
  title: string;
  style: AgentStyle;
  skillProfileId: SkillProfileId;
  identity: string;
}

export interface TeamTemplate {
  id: TeamTemplateId;
  name: string;
  description: string;
  icon: string;
  agents: AgentPreset[];
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
  return { ...agent };
}

function cloneTeamTemplate(template: TeamTemplate): TeamTemplate {
  return {
    ...template,
    agents: template.agents.map(cloneAgentPreset),
  };
}

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
    // Shared builder profiles stay reusable by carrying framework-specific bindings behind conditions.
    bind(SKILL_REPOS.nextSkills, "api-routes", "next.js app router, route handlers, api endpoints"),
    bind(SKILL_REPOS.nextSkills, "nextjs-patterns", "next.js app structure, routing, layouts, data fetching"),
    bind(
      SKILL_REPOS.nextSkills,
      "react-server-components",
      "react server components, server client boundaries, next.js rendering",
    ),
  ],
  builder: [
    bind(SKILL_REPOS.superpowers, "test-driven-development"),
    bind(SKILL_REPOS.superpowers, "systematic-debugging"),
    bind(SKILL_REPOS.superpowers, "verification-before-completion"),
    bind(SKILL_REPOS.superpowers, "finishing-a-development-branch"),
    bind(SKILL_REPOS.nextSkills, "nextjs-patterns", "next.js ui flows, routing, layouts, app router"),
    bind(
      SKILL_REPOS.nextSkills,
      "react-server-components",
      "react server components, server client boundaries, data fetching placement",
    ),
  ],
  planner: [
    bind(SKILL_REPOS.superpowers, "brainstorming"),
    bind(SKILL_REPOS.superpowers, "writing-plans"),
    bind(SKILL_REPOS.superpowers, "verification-before-completion"),
  ],
  researcher: [
    bind(SKILL_REPOS.superpowers, "brainstorming"),
    bind(SKILL_REPOS.superpowers, "writing-plans"),
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

const teamTemplatesData: TeamTemplate[] = [
  {
    id: "engineering",
    name: "Engineering",
    description: "Product engineering squad covering backend, frontend, and quality gates.",
    icon: "hammer",
    agents: [
      {
        roleKey: "backend-engineer",
        name: "Backend Engineer",
        title: "Senior Backend Engineer",
        style: "specialist",
        skillProfileId: "senior-builder",
        identity: "Own backend contracts, data integrity, and safe delivery under real production constraints.",
      },
      {
        roleKey: "frontend-engineer",
        name: "Frontend Engineer",
        title: "Senior Frontend Engineer",
        style: "balanced",
        skillProfileId: "senior-builder",
        identity: "Own product-facing UI quality, interaction design fidelity, and maintainable front-end architecture.",
      },
      {
        roleKey: "qa-engineer",
        name: "QA Engineer",
        title: "QA Engineer",
        style: "conservative",
        skillProfileId: "reviewer",
        identity: "Find regressions early, tighten acceptance boundaries, and force evidence before release claims.",
      },
    ],
  },
  {
    id: "product",
    name: "Product",
    description: "Discovery and prioritization pair for product direction, scope, and validation.",
    icon: "clipboard-list",
    agents: [
      {
        roleKey: "product-manager",
        name: "Product Manager",
        title: "Product Manager",
        style: "balanced",
        skillProfileId: "planner",
        identity: "Turn ambiguous requests into scoped bets, crisp plans, and explicit tradeoffs the team can execute.",
      },
      {
        roleKey: "analyst",
        name: "Analyst",
        title: "Product Analyst",
        style: "specialist",
        skillProfileId: "researcher",
        identity: "Ground decisions in evidence, identify gaps in the brief, and surface the signal behind user behavior.",
      },
    ],
  },
  {
    id: "growth",
    name: "Growth",
    description: "Experiment and content team focused on acquisition, activation, and learning loops.",
    icon: "megaphone",
    agents: [
      {
        roleKey: "growth-marketer",
        name: "Growth Marketer",
        title: "Growth Marketer",
        style: "balanced",
        skillProfileId: "strategist-lead",
        identity: "Design growth experiments with clear hypotheses, sequencing, and measurable outcomes.",
      },
      {
        roleKey: "content-writer",
        name: "Content Writer",
        title: "Content Strategist",
        style: "balanced",
        skillProfileId: "researcher",
        identity: "Translate product and audience insight into clear narratives, launch copy, and feedback loops.",
      },
    ],
  },
  {
    id: "data",
    name: "Data",
    description: "Delivery-focused data team for pipelines, analytics models, and applied ML work.",
    icon: "database",
    agents: [
      {
        roleKey: "data-engineer",
        name: "Data Engineer",
        title: "Data Engineer",
        style: "specialist",
        skillProfileId: "senior-builder",
        identity: "Build reliable data pipelines, schemas, and transformations with a bias toward traceability.",
      },
      {
        roleKey: "ml-engineer",
        name: "ML Engineer",
        title: "ML Engineer",
        style: "specialist",
        skillProfileId: "senior-builder",
        identity: "Ship model-backed systems pragmatically, with evaluation, rollback paths, and tight production feedback.",
      },
    ],
  },
  {
    id: "design",
    name: "Design",
    description: "UX and UI pairing for flows, interaction models, and polished product surfaces.",
    icon: "palette",
    agents: [
      {
        roleKey: "ux-designer",
        name: "UX Designer",
        title: "UX Designer",
        style: "balanced",
        skillProfileId: "planner",
        identity: "Clarify user intent, reduce friction in flows, and turn product goals into coherent interaction design.",
      },
      {
        roleKey: "ui-designer",
        name: "UI Designer",
        title: "UI Designer",
        style: "specialist",
        skillProfileId: "builder",
        identity: "Refine interfaces into consistent, high-signal UI systems that are practical to build and maintain.",
      },
    ],
  },
  {
    id: "infra",
    name: "Infrastructure",
    description: "Platform reliability team for delivery pipelines, runtime stability, and operational safety.",
    icon: "server",
    agents: [
      {
        roleKey: "devops-engineer",
        name: "DevOps Engineer",
        title: "DevOps Engineer",
        style: "specialist",
        skillProfileId: "senior-builder",
        identity: "Own delivery automation, deployment safety, and infrastructure changes that must fail predictably.",
      },
      {
        roleKey: "sre",
        name: "SRE",
        title: "Site Reliability Engineer",
        style: "conservative",
        skillProfileId: "reviewer",
        identity: "Guard uptime, incident readiness, and operational correctness by challenging risky assumptions early.",
      },
    ],
  },
  {
    id: "security",
    name: "Security",
    description: "Risk-focused team for secure defaults, review pressure, and adversarial validation.",
    icon: "shield",
    agents: [
      {
        roleKey: "security-engineer",
        name: "Security Engineer",
        title: "Security Engineer",
        style: "conservative",
        skillProfileId: "reviewer",
        identity: "Stress the system at trust boundaries and turn vague risk into concrete engineering requirements.",
      },
      {
        roleKey: "pen-tester",
        name: "Pen Tester",
        title: "Penetration Tester",
        style: "specialist",
        skillProfileId: "reviewer",
        identity: "Think like an adversary, find exploit paths, and make the attack surface legible to builders.",
      },
    ],
  },
  {
    id: "research",
    name: "Research",
    description: "Research and synthesis pair for investigations, briefs, and decision support.",
    icon: "flask-conical",
    agents: [
      {
        roleKey: "researcher",
        name: "Researcher",
        title: "Researcher",
        style: "balanced",
        skillProfileId: "researcher",
        identity: "Investigate fast-changing domains, synthesize evidence, and surface the governing model behind decisions.",
      },
      {
        roleKey: "technical-writer",
        name: "Technical Writer",
        title: "Technical Writer",
        style: "balanced",
        skillProfileId: "planner",
        identity: "Turn complex implementation detail into clear docs, rollout notes, and operational guidance.",
      },
    ],
  },
];

export const TEAM_TEMPLATES: TeamTemplate[] = teamTemplatesData.map(cloneTeamTemplate);

const skillProfileMap = new Map<SkillProfileId, SkillProfile>(SKILL_PROFILES.map((profile) => [profile.id, profile]));
const teamTemplateMap = new Map<TeamTemplateId, TeamTemplate>(TEAM_TEMPLATES.map((template) => [template.id, template]));

export function getSkillProfile(id: SkillProfileId | null | undefined): SkillProfile | null {
  if (!id) return null;
  const profile = skillProfileMap.get(id);
  return profile ? cloneSkillProfile(profile) : null;
}

export function getSkillProfileBindings(id: SkillProfileId | null | undefined): SkillReference[] {
  const profile = getSkillProfile(id);
  return profile ? profile.skills : [];
}

export function getTeamTemplate(id: TeamTemplateId | null | undefined): TeamTemplate | null {
  if (!id) return null;
  const template = teamTemplateMap.get(id);
  return template ? cloneTeamTemplate(template) : null;
}

export function listTeamTemplates(): TeamTemplate[] {
  return TEAM_TEMPLATES.map(cloneTeamTemplate);
}
