export function agentAvatarUrl(id: string, color?: string, size = 20): string {
  const bg = color ? color.replace("#", "") : "e2e8f0";
  return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(id)}&size=${size}&backgroundColor=${bg}`;
}

export function openLinearIssueTab(issueUrl: string): void {
  const opened = window.open(issueUrl, "_blank", "noopener,noreferrer");
  opened?.focus();
}
