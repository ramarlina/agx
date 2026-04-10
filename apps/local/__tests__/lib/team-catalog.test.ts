/**
 * @jest-environment node
 */

import {
  getAgentPresetBindings,
  getSkillProfile,
  getSkillProfileBindings,
  getTeamTemplate,
  listTeamTemplates,
  SKILL_PROFILES,
  SKILL_PROFILE_IDS,
  SKILL_REPOS,
  TEAM_TEMPLATES,
  TEAM_TEMPLATE_IDS,
} from "@/lib/team-catalog";

describe("team catalog", () => {
  test("ships the expected skill profile ids", () => {
    expect(SKILL_PROFILES.map((profile) => profile.id)).toEqual([...SKILL_PROFILE_IDS]);
  });

  test("ships the expected team template ids and counts", () => {
    expect(TEAM_TEMPLATES.map((template) => template.id)).toEqual([...TEAM_TEMPLATE_IDS]);
    expect(TEAM_TEMPLATES).toHaveLength(9);
    expect(getTeamTemplate("engineering")?.agents).toHaveLength(3);
  });

  test("every agent references a valid skill profile and keeps unique role keys within a template", () => {
    const validProfileIds = new Set(SKILL_PROFILE_IDS);

    for (const template of TEAM_TEMPLATES) {
      const roleKeys = new Set<string>();

      for (const agent of template.agents) {
        expect(validProfileIds.has(agent.skillProfileId)).toBe(true);
        expect(roleKeys.has(agent.roleKey)).toBe(false);
        roleKeys.add(agent.roleKey);
      }
    }
  });

  test("lookup helpers resolve copies instead of leaking shared mutable data", () => {
    const originalProfile = getSkillProfile("builder");
    const mutatedProfile = getSkillProfile("builder");

    expect(originalProfile).not.toBeNull();
    expect(mutatedProfile).not.toBeNull();

    mutatedProfile!.skills[0].skillId = "mutated-skill";

    expect(getSkillProfile("builder")?.skills[0].skillId).not.toBe("mutated-skill");
    expect(originalProfile).not.toBe(mutatedProfile);

    const originalTemplate = getTeamTemplate("engineering");
    const mutatedTemplate = getTeamTemplate("engineering");

    expect(originalTemplate).not.toBeNull();
    expect(mutatedTemplate).not.toBeNull();

    mutatedTemplate!.agents[0].name = "Mutated";

    expect(getTeamTemplate("engineering")?.agents[0].name).toBe("Backend Engineer");
    expect(originalTemplate).not.toBe(mutatedTemplate);
    expect(listTeamTemplates()).toHaveLength(9);
  });

  test("senior-builder profile has no framework-specific bindings", () => {
    const bindings = getSkillProfileBindings("senior-builder");

    expect(bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repo: SKILL_REPOS.superpowers,
          skillId: "test-driven-development",
        }),
      ]),
    );
    expect(bindings.every((b) => b.repo === SKILL_REPOS.superpowers)).toBe(true);
  });

  test("web-facing agents carry Next.js extraSkills via getAgentPresetBindings", () => {
    const eng = getTeamTemplate("engineering")!;
    const frontend = eng.agents.find((a) => a.roleKey === "frontend-engineer")!;
    const backend = eng.agents.find((a) => a.roleKey === "backend-engineer")!;

    const frontendBindings = getAgentPresetBindings(frontend);
    const backendBindings = getAgentPresetBindings(backend);

    // Frontend gets Next.js skills
    expect(frontendBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ repo: SKILL_REPOS.nextSkills, skillId: "api-routes" }),
        expect.objectContaining({ repo: SKILL_REPOS.nextSkills, skillId: "react-server-components" }),
      ]),
    );

    // Backend does not
    expect(backendBindings.some((b) => b.repo === SKILL_REPOS.nextSkills)).toBe(false);
  });

  test("extraSkills on cloned templates do not leak mutations", () => {
    const t1 = getTeamTemplate("engineering")!;
    const t2 = getTeamTemplate("engineering")!;
    const fe1 = t1.agents.find((a) => a.roleKey === "frontend-engineer")!;
    const fe2 = t2.agents.find((a) => a.roleKey === "frontend-engineer")!;

    fe1.extraSkills![0].skillId = "mutated";
    expect(fe2.extraSkills![0].skillId).not.toBe("mutated");
  });

  test("researcher profile includes systematic-debugging unlike planner", () => {
    const researcher = getSkillProfileBindings("researcher");
    const planner = getSkillProfileBindings("planner");

    expect(researcher.some((b) => b.skillId === "systematic-debugging")).toBe(true);
    expect(planner.some((b) => b.skillId === "systematic-debugging")).toBe(false);
  });

  test("security-engineer uses senior-builder profile to implement fixes", () => {
    const sec = getTeamTemplate("security")!;
    const engineer = sec.agents.find((a) => a.roleKey === "security-engineer")!;
    expect(engineer.skillProfileId).toBe("senior-builder");
  });
});
