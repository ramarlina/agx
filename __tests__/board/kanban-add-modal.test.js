const fs = require('fs');
const path = require('path');

describe('Kanban column add behavior (bundled board runtime)', () => {
  const kanbanChunkDir = path.join(
    process.cwd(),
    'cloud-runtime',
    'standalone',
    'Projects',
    'Agents',
    'agx-cloud',
    '.next',
    'static',
    'chunks'
  );
  const kanbanChunk = (() => {
    const entries = fs.readdirSync(kanbanChunkDir);
    const chunk = entries.find((entry) => /^9337-.*\.js$/.test(entry));
    if (!chunk) {
      throw new Error(`Kanban chunk (9337-*) not found in ${kanbanChunkDir}`);
    }
    return path.join(kanbanChunkDir, chunk);
  })();

  const dashboardChunkDir = path.join(
    process.cwd(),
    'cloud-runtime',
    'standalone',
    'Projects',
    'Agents',
    'agx-cloud',
    '.next',
    'static',
    'chunks',
    'app',
    'dashboard'
  );
  const dashboardChunk = (() => {
    const entries = fs.readdirSync(dashboardChunkDir);
    const pageChunk = entries.find((entry) => /^page-.*\.js$/.test(entry));
    if (!pageChunk) {
      throw new Error(`Dashboard chunk not found in ${dashboardChunkDir}`);
    }
    return path.join(dashboardChunkDir, pageChunk);
  })();

  test('column + delegates to onAddTask callback', () => {
    const content = fs.readFileSync(kanbanChunk, 'utf8');
    expect(content).toMatch(/onClick:\(\)=>null==[a-z]\?void 0:[a-z]\([a-z]\)/);
  });

  test('dashboard includes draft TaskDetail modal wiring', () => {
    const content = fs.readFileSync(dashboardChunk, 'utf8');
    expect(content).toMatch(/isDraft:!0/);
    expect(content).toMatch(/onClose:\(\)=>[A-Za-z]\(null\)/);
    expect(content).toMatch(/onAddComment:/);
    expect(content).toMatch(/onAddLearning:/);
    expect(content).toMatch(/onUpdate:async/);
  });
});
