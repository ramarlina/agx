export function createCliChunkSanitizer() {
  let endedWithNewline = false;
  let hasEmittedContent = false;
  let lastNonWhitespaceChar = "";

  const markdownBlockStartPattern =
    /^(?:```|~~~|#{1,6}\s|>\s|[-*+]\s|\d+\.\s)/;

  return (value: string): string => {
    const normalized = value
      .replace(/\u001B\[[0-9;]*[A-Za-z]/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");

    if (!normalized.trim()) {
      if (normalized.includes("\n") && !endedWithNewline) {
        endedWithNewline = true;
        return "\n";
      }
      return "";
    }

    const dedupedLeadingNewlines = endedWithNewline
      ? normalized.replace(/^\n+/, "\n")
      : normalized;

    const trimmedStart = dedupedLeadingNewlines.trimStart();
    const startsMarkdownBlock = markdownBlockStartPattern.test(trimmedStart);
    const needsBlockSeparator =
      hasEmittedContent && startsMarkdownBlock && !endedWithNewline;
    const needsSentenceSpacing =
      hasEmittedContent &&
      !endedWithNewline &&
      !needsBlockSeparator &&
      !/^\s/.test(dedupedLeadingNewlines) &&
      /[.!?)]/.test(lastNonWhitespaceChar) &&
      /^[A-Z0-9`(]/.test(dedupedLeadingNewlines);

    const output = needsBlockSeparator
      ? `\n\n${dedupedLeadingNewlines}`
      : needsSentenceSpacing
        ? `\n${dedupedLeadingNewlines}`
        : dedupedLeadingNewlines;

    endedWithNewline = output.endsWith("\n");
    hasEmittedContent = hasEmittedContent || output.trim().length > 0;
    const trailing = output.replace(/\s+$/g, "");
    if (trailing.length > 0) {
      lastNonWhitespaceChar =
        trailing[trailing.length - 1] ?? lastNonWhitespaceChar;
    }
    return output;
  };
}
