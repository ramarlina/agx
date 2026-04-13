const fs = require('fs');
const os = require('os');
const path = require('path');

const { getBundledBoardServerEntry } = require('../../lib/cli/daemon');

describe('daemon bundled board entry selection', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agx-daemon-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('prefers the bundled custom server when present', () => {
    fs.writeFileSync(path.join(tmpDir, 'agx-server.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'server.js'), '');

    expect(getBundledBoardServerEntry(tmpDir)).toBe('agx-server.js');
  });

  test('falls back to the stock standalone server for older packages', () => {
    fs.writeFileSync(path.join(tmpDir, 'server.js'), '');

    expect(getBundledBoardServerEntry(tmpDir)).toBe('server.js');
  });
});
