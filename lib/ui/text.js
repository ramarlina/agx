const fs = require('fs');
const path = require('path');

function truncateForComment(text, maxChars = 12000) {
  const value = String(text || '');
  if (value.length <= maxChars) return value;
  return `[truncated]\n\n${value.slice(-maxChars)}`;
}

function cleanAgentOutputForComment(text) {
  if (!text) return '';
  // This token line appears in some provider outputs; keep the final chunk.
  const finalChunk = (String(text).split('[3m[35mtokens used[0m[0m').slice(-1)[0] || '').trim();
  const lines = finalChunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const noiseMatchers = [
    /^tool call result/i,
    /^tool call results/i,
    /^thinking tokens/i
  ];

  const filteredLines = lines.filter((line) => {
    return !noiseMatchers.some((matcher) => matcher.test(line));
  });

  const cleaned = filteredLines.join('\n').trim();
  return cleaned || finalChunk;
}

function extractFileRefsFromText(text, { max = 20 } = {}) {
  const raw = String(text || '');
  if (!raw.trim()) return [];

  const exts = '(?:md|js|mjs|cjs|ts|tsx|jsx|json|patch|diff|txt|ndjson|yaml|yml)';
  const refs = new Set();
  const addRef = (ref) => {
    const value = String(ref || '').trim();
    if (!value) return;
    if (refs.has(value)) return;
    refs.add(value);
  };

  const patterns = [
    // Absolute POSIX paths, optionally with :line or :line:col suffix.
    new RegExp(String.raw`(?:^|\s)(\/[^\s'"<>]+?\.(?:${exts})(?::\d+(?::\d+)?)?)(?=$|\s)`, 'g'),
    // Repo-relative paths, optionally with :line or :line:col suffix.
    new RegExp(String.raw`(?:^|\s)([A-Za-z0-9_.\/-]+?\.(?:${exts})(?::\d+(?::\d+)?)?)(?=$|\s)`, 'g'),
  ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(raw)) !== null) {
      const candidate = String(match[1] || '').replace(/[),.;\]]+$/g, '');
      if (!candidate) continue;

      const [filePart] = candidate.split(':');
      if (!filePart) continue;

      // Only keep refs that exist on disk (helps avoid random false positives).
      const abs = filePart.startsWith('/') ? filePart : path.resolve(process.cwd(), filePart);
      try {
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          const suffix = candidate.slice(filePart.length); // preserve :line[:col] if present
          addRef(`${abs}${suffix}`);
          if (refs.size >= max) break;
        }
      } catch { }
      if (refs.size >= max) break;
    }
    if (refs.size >= max) break;
  }

  return Array.from(refs);
}

module.exports = { truncateForComment, cleanAgentOutputForComment, extractFileRefsFromText };

