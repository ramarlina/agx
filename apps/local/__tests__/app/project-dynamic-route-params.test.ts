import fs from "fs";
import path from "path";

const ticketReproRouteFiles = [
  "app/projects/[slug]/layout.tsx",
  "app/projects/[slug]/page.tsx",
  "app/projects/[slug]/automations/page.tsx",
  "app/projects/[slug]/teams/page.tsx",
  "app/projects/[slug]/folders/page.tsx",
];

const ticketReproClientFiles = [
  "app/projects/[slug]/ProjectLayoutClient.tsx",
  "app/projects/[slug]/ProjectPageClient.tsx",
  "app/projects/[slug]/automations/ProjectAutomationsPageClient.tsx",
  "app/projects/[slug]/teams/TeamsPageClient.tsx",
  "app/projects/[slug]/folders/FoldersPageClient.tsx",
];

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("project dynamic route params for the crash repro routes", () => {
  it("resolves ticket repro route params in server wrappers", () => {
    for (const file of ticketReproRouteFiles) {
      const source = readSource(file);

      expect(source).not.toMatch(/^"use client";/);
      expect(source).toContain("await params");
      expect(source).not.toContain("use(params)");
    }
  });

  it("passes plain slug strings into client route components", () => {
    for (const file of ticketReproClientFiles) {
      const source = readSource(file);

      expect(source).toContain('"use client";');
      expect(source).toContain("slug: string");
      expect(source).not.toContain("params: Promise");
      expect(source).not.toContain("use(params)");
    }
  });
});
