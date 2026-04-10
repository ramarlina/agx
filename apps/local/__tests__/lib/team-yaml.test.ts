/**
 * @jest-environment node
 */

import { serializeTeams, deserializeTeams } from "@/lib/team-yaml";
import type { Team, TeamAgent } from "@/lib/db";

function makeTeam(overrides: Partial<Team> & { agents: TeamAgent[] }): Team & { agents: TeamAgent[] } {
  return {
    id: "team-1",
    project_id: "proj-1",
    name: "Engineering",
    template_id: "engineering",
    metadata: {},
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeAgent(overrides: Partial<TeamAgent> = {}): TeamAgent {
  return {
    team_id: "team-1",
    agent_id: "agent-1",
    role_key: "backend-engineer",
    routing_order: 0,
    ...overrides,
  };
}

describe("team-yaml", () => {
  describe("serializeTeams", () => {
    test("serializes teams with agents to YAML", () => {
      const teams = [
        makeTeam({
          name: "Engineering",
          template_id: "engineering",
          agents: [
            makeAgent({ role_key: "backend-engineer", agent_id: "agent-1", routing_order: 0 }),
            makeAgent({ role_key: "frontend-engineer", agent_id: "agent-2", routing_order: 1 }),
          ],
        }),
      ];

      const yaml = serializeTeams(teams);

      expect(yaml).toContain("version: 1");
      expect(yaml).toContain("name: Engineering");
      expect(yaml).toContain("template_id: engineering");
      expect(yaml).toContain("role_key: backend-engineer");
      expect(yaml).toContain("role_key: frontend-engineer");
      expect(yaml).toContain("agent_id: agent-1");
      expect(yaml).toContain("agent_id: agent-2");
    });

    test("serializes teams with null template_id", () => {
      const teams = [
        makeTeam({ name: "Custom", template_id: null, agents: [] }),
      ];

      const yaml = serializeTeams(teams);
      expect(yaml).toContain("template_id: null");
    });

    test("serializes empty teams array", () => {
      const yaml = serializeTeams([]);
      expect(yaml).toContain("version: 1");
      expect(yaml).toContain("teams: []");
    });
  });

  describe("deserializeTeams", () => {
    test("deserializes valid YAML", () => {
      const yaml = `
version: 1
teams:
  - name: Engineering
    template_id: engineering
    agents:
      - role_key: backend-engineer
        agent_id: agent-1
        routing_order: 0
      - role_key: frontend-engineer
        agent_id: agent-2
        routing_order: 1
`;

      const doc = deserializeTeams(yaml);

      expect(doc.version).toBe(1);
      expect(doc.teams).toHaveLength(1);
      expect(doc.teams[0].name).toBe("Engineering");
      expect(doc.teams[0].template_id).toBe("engineering");
      expect(doc.teams[0].agents).toHaveLength(2);
      expect(doc.teams[0].agents[0]).toEqual({
        role_key: "backend-engineer",
        agent_id: "agent-1",
        routing_order: 0,
      });
    });

    test("deserializes empty teams array", () => {
      const yaml = `
version: 1
teams: []
`;
      const doc = deserializeTeams(yaml);
      expect(doc.version).toBe(1);
      expect(doc.teams).toEqual([]);
    });

    test("deserializes teams with null template_id", () => {
      const yaml = `
version: 1
teams:
  - name: Custom
    template_id: null
    agents: []
`;
      const doc = deserializeTeams(yaml);
      expect(doc.teams[0].template_id).toBeNull();
    });

    test("throws on invalid YAML", () => {
      expect(() => deserializeTeams("{{invalid")).toThrow();
    });

    test("throws on missing version", () => {
      const yaml = `
teams:
  - name: Foo
    agents: []
`;
      expect(() => deserializeTeams(yaml)).toThrow(/version/i);
    });

    test("throws on unsupported version", () => {
      const yaml = `
version: 2
teams: []
`;
      expect(() => deserializeTeams(yaml)).toThrow(/version/i);
    });

    test("throws on missing teams array", () => {
      const yaml = `
version: 1
`;
      expect(() => deserializeTeams(yaml)).toThrow(/teams/i);
    });

    test("throws on missing team name", () => {
      const yaml = `
version: 1
teams:
  - template_id: null
    agents: []
`;
      expect(() => deserializeTeams(yaml)).toThrow(/name/i);
    });

    test("throws on invalid agent entry", () => {
      const yaml = `
version: 1
teams:
  - name: Foo
    template_id: null
    agents:
      - role_key: test
        routing_order: 0
`;
      expect(() => deserializeTeams(yaml)).toThrow(/agent_id/i);
    });
  });

  describe("round-trip", () => {
    test("serialize then deserialize produces equivalent data", () => {
      const teams = [
        makeTeam({
          name: "Engineering",
          template_id: "engineering",
          agents: [
            makeAgent({ role_key: "backend-engineer", agent_id: "agent-1", routing_order: 0 }),
            makeAgent({ role_key: "frontend-engineer", agent_id: "agent-2", routing_order: 1 }),
          ],
        }),
        makeTeam({
          id: "team-2",
          name: "Design",
          template_id: null,
          agents: [
            makeAgent({ team_id: "team-2", role_key: "ux-designer", agent_id: "agent-3", routing_order: 0 }),
          ],
        }),
      ];

      const yaml = serializeTeams(teams);
      const doc = deserializeTeams(yaml);

      expect(doc.version).toBe(1);
      expect(doc.teams).toHaveLength(2);

      expect(doc.teams[0].name).toBe("Engineering");
      expect(doc.teams[0].template_id).toBe("engineering");
      expect(doc.teams[0].agents).toEqual([
        { role_key: "backend-engineer", agent_id: "agent-1", routing_order: 0 },
        { role_key: "frontend-engineer", agent_id: "agent-2", routing_order: 1 },
      ]);

      expect(doc.teams[1].name).toBe("Design");
      expect(doc.teams[1].template_id).toBeNull();
      expect(doc.teams[1].agents).toEqual([
        { role_key: "ux-designer", agent_id: "agent-3", routing_order: 0 },
      ]);
    });

    test("round-trip with empty teams", () => {
      const yaml = serializeTeams([]);
      const doc = deserializeTeams(yaml);
      expect(doc.teams).toEqual([]);
    });
  });
});
