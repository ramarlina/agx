const fs = require('fs');
const path = require('path');

describe('Kanban column add behavior (bundled board runtime)', () => {
  const kanbanChunk = path.join(
    process.cwd(),
    'cloud-runtime',
    'standalone',
    'Projects',
    'Agents',
    'agx-cloud',
    '.next',
    'static',
    'chunks',
    '9337-09000d8a6c85f40c.js'
  );

  const dashboardChunk = path.join(
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
    'dashboard',
    'page-7437499eb05d5ce8.js'
  );

  test('column + delegates to onAddTask callback', () => {
    const content = fs.readFileSync(kanbanChunk, 'utf8');
    expect(content).toContain('onClick:()=>null==i?void 0:i(r)');
  });

  test('dashboard includes draft TaskDetail modal wiring', () => {
    const content = fs.readFileSync(dashboardChunk, 'utf8');
    expect(content).toContain('onClose:()=>D(null)');
    expect(content).toContain('onAddComment:eO');
    expect(content).toContain('onUpdate:ez');
    expect(content).toContain('isDraft:!0');
    expect(content).toContain('onUpdate:eF');
  });
});
