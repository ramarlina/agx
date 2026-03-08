const path = require('path');

const {
  getBundledDesktopAppPath,
  isBundledDesktopCli,
} = require('../../lib/commands/update');

describe('update command desktop detection', () => {
  test('detects bundled CLI inside agx.app resources', () => {
    const cliPath = path.join(
      '/Applications',
      'agx.app',
      'Contents',
      'Resources',
      'cli',
      'index.js'
    );

    expect(getBundledDesktopAppPath(cliPath)).toBe('/Applications/agx.app');
    expect(isBundledDesktopCli(cliPath)).toBe(true);
  });

  test('returns null for standalone CLI path', () => {
    const cliPath = path.join('/usr', 'local', 'lib', 'node_modules', '@mndrk', 'agx', 'index.js');

    expect(getBundledDesktopAppPath(cliPath)).toBeNull();
    expect(isBundledDesktopCli(cliPath)).toBe(false);
  });
});
