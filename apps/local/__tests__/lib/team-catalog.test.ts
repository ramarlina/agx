/**
 * @jest-environment node
 */

import {
  getAgentPreset,
  getAgentPresetBindings,
  getSkillProfile,
  getSkillProfileBindings,
  getTeamTemplate,
  getTemplateVariant,
  listAgentPresets,
  listTeamTemplates,
  AGENT_PRESETS,
  AGENT_PRESET_IDS,
  SKILL_PROFILES,
  SKILL_PROFILE_IDS,
  SKILL_REPOS,
  TEAM_TEMPLATES,
  TEAM_TEMPLATE_IDS,
} from "@/lib/team-catalog";

describe("team catalog", () => {
  // --- Skill profiles ---

  test("ships the expected skill profile ids", () => {
    expect(SKILL_PROFILES.map((p) => p.id)).toEqual([...SKILL_PROFILE_IDS]);
  });

  test("senior-builder profile has no framework-specific bindings", () => {
    const bindings = getSkillProfileBindings("senior-builder");
    expect(bindings.every((b) => b.repo === SKILL_REPOS.superpowers)).toBe(true);
  });

  test("researcher profile includes systematic-debugging unlike planner", () => {
    const researcher = getSkillProfileBindings("researcher");
    const planner = getSkillProfileBindings("planner");
    expect(researcher.some((b) => b.skillId === "systematic-debugging")).toBe(true);
    expect(planner.some((b) => b.skillId === "systematic-debugging")).toBe(false);
  });

  // --- Agent presets ---

  test("ships the expected agent preset ids", () => {
    expect(AGENT_PRESETS.map((p) => p.id)).toEqual([...AGENT_PRESET_IDS]);
    expect(AGENT_PRESETS).toHaveLength(29);
  });

  test("every preset references a valid skill profile", () => {
    const validProfileIds = new Set(SKILL_PROFILE_IDS);
    for (const preset of AGENT_PRESETS) {
      expect(validProfileIds.has(preset.skillProfileId)).toBe(true);
    }
  });

  test("getAgentPreset returns a clone", () => {
    const a = getAgentPreset("qa-engineer");
    const b = getAgentPreset("qa-engineer");
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a!.name = "Mutated";
    expect(getAgentPreset("qa-engineer")!.name).toBe("QA Engineer");
  });

  test("web-facing presets carry Next.js extraSkills", () => {
    const frontend = getAgentPreset("frontend-engineer")!;
    const backend = getAgentPreset("backend-engineer")!;
    expect(getAgentPresetBindings(frontend).some((b) => b.repo === SKILL_REPOS.nextSkills)).toBe(true);
    expect(getAgentPresetBindings(backend).some((b) => b.repo === SKILL_REPOS.nextSkills)).toBe(false);
  });

  test("getAgentPresetBindings accepts preset ID string", () => {
    expect(getAgentPresetBindings("frontend-engineer").some((b) => b.repo === SKILL_REPOS.nextSkills)).toBe(true);
  });

  test("security-engineer uses senior-builder profile", () => {
    expect(getAgentPreset("security-engineer")!.skillProfileId).toBe("senior-builder");
  });

  // --- Team templates ---

  test("ships the expected team template ids", () => {
    expect(TEAM_TEMPLATES.map((t) => t.id)).toEqual([...TEAM_TEMPLATE_IDS]);
    expect(TEAM_TEMPLATES).toHaveLength(9);
  });

  test("engineering template has variants", () => {
    const eng = getTeamTemplate("engineering")!;
    expect(eng.variants).toBeDefined();
    expect(eng.variants!.length).toBeGreaterThanOrEqual(5);

    const variantIds = eng.variants!.map((v) => v.id);
    expect(variantIds).toContain("general");
    expect(variantIds).toContain("ai");
    expect(variantIds).toContain("data");
    expect(variantIds).toContain("infra");
    expect(variantIds).toContain("security");
  });

  test("getTemplateVariant resolves engineering variants", () => {
    const ai = getTemplateVariant("engineering", "ai");
    expect(ai).not.toBeNull();
    expect(ai!.agents.some((a) => a.id === "ml-engineer")).toBe(true);

    const missing = getTemplateVariant("engineering", "nonexistent");
    expect(missing).toBeNull();
  });

  test("templates without variants have no variants field or empty array", () => {
    const product = getTeamTemplate("product")!;
    expect(product.variants ?? []).toHaveLength(0);
  });

  test("every template and variant agent is a valid preset", () => {
    const validPresetIds = new Set(AGENT_PRESET_IDS);

    for (const template of TEAM_TEMPLATES) {
      for (const agent of template.agents) {
        expect(validPresetIds.has(agent.id)).toBe(true);
      }
      for (const variant of template.variants ?? []) {
        for (const agent of variant.agents) {
          expect(validPresetIds.has(agent.id)).toBe(true);
        }
      }
    }
  });

  test("template agents are independent clones of the preset registry", () => {
    const eng = getTeamTemplate("engineering")!;
    const qaFromTemplate = eng.agents.find((a) => a.id === "qa-engineer")!;
    const qaFromRegistry = getAgentPreset("qa-engineer")!;

    expect(qaFromTemplate).toEqual(qaFromRegistry);
    expect(qaFromTemplate).not.toBe(qaFromRegistry);

    qaFromTemplate.name = "Mutated";
    expect(getAgentPreset("qa-engineer")!.name).toBe("QA Engineer");
  });

  test("variant agents are independent clones", () => {
    const v1 = getTemplateVariant("engineering", "ai")!;
    const v2 = getTemplateVariant("engineering", "ai")!;

    v1.agents[0].name = "Mutated";
    expect(v2.agents[0].name).not.toBe("Mutated");
  });

  test("lookup helpers resolve copies instead of leaking shared mutable data", () => {
    const a = getSkillProfile("builder");
    const b = getSkillProfile("builder");
    b!.skills[0].skillId = "mutated-skill";
    expect(getSkillProfile("builder")?.skills[0].skillId).not.toBe("mutated-skill");

    expect(listTeamTemplates()).toHaveLength(9);
    expect(listAgentPresets()).toHaveLength(29);
  });

  test("extraSkills on cloned templates do not leak mutations", () => {
    const t1 = getTeamTemplate("engineering")!;
    const t2 = getTeamTemplate("engineering")!;
    const fe1 = t1.agents.find((a) => a.id === "frontend-engineer")!;
    const fe2 = t2.agents.find((a) => a.id === "frontend-engineer")!;

    fe1.extraSkills![0].skillId = "mutated";
    expect(fe2.extraSkills![0].skillId).not.toBe("mutated");
  });
});
