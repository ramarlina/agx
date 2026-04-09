/**
 * @jest-environment node
 */

import {
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
    expect(TEAM_TEMPLATES).toHaveLength(8);
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
    expect(listTeamTemplates()).toHaveLength(8);
  });

  test("senior builder profile preserves multi-repo bindings with explicit activation hints", () => {
    const bindings = getSkillProfileBindings("senior-builder");

    expect(bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repo: SKILL_REPOS.superpowers,
          skillId: "test-driven-development",
        }),
        expect.objectContaining({
          repo: SKILL_REPOS.nextSkills,
          skillId: "api-routes",
          condition: expect.any(String),
        }),
        expect.objectContaining({
          repo: SKILL_REPOS.nextSkills,
          skillId: "react-server-components",
          condition: expect.any(String),
        }),
      ]),
    );
  });
});
