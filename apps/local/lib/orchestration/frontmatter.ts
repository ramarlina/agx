export function stringifyFrontmatter(frontmatter: Record<string, unknown>): string {
  return Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${value === null || typeof value === "undefined" ? "" : String(value)}`)
    .join("\n");
}

export function buildMarkdownWithFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${stringifyFrontmatter(frontmatter)}\n---\n${body}`;
}
