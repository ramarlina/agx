const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CUSTOM_SERVER_ENTRY,
  GA_MEASUREMENT_ID,
  GA_SCRIPT_URL,
  buildGoogleAnalyticsSnippet,
  copyNodePtyPrebuilds,
  injectGoogleAnalyticsIntoHtmlFile,
  patchStandalonePackageScripts,
} = require('../../scripts/package-board-runtime');

describe('package-board-runtime Google Analytics helpers', () => {
  describe('buildGoogleAnalyticsSnippet', () => {
    test('includes preload link when requested', () => {
      const snippet = buildGoogleAnalyticsSnippet(true);
      expect(snippet).toContain(`<link rel="preload" href="${GA_SCRIPT_URL}" as="script"/>`);
      expect(snippet).toContain(`<script async src="${GA_SCRIPT_URL}"></script>`);
      expect(snippet).toContain(`gtag('config', '${GA_MEASUREMENT_ID}');`);
    });

    test('omits preload link when not requested', () => {
      const snippet = buildGoogleAnalyticsSnippet(false);
      expect(snippet).not.toContain(`rel="preload"`);
      expect(snippet).toContain(`<script async src="${GA_SCRIPT_URL}"></script>`);
    });
  });

  describe('injectGoogleAnalyticsIntoHtmlFile', () => {
    let tmpDir;
    let htmlPath;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agx-ga-'));
      htmlPath = path.join(tmpDir, 'index.html');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function expectSnippetPresent(content) {
      expect(content).toContain(`<script async src="${GA_SCRIPT_URL}"></script>`);
      expect(content).toContain(`gtag('config', '${GA_MEASUREMENT_ID}');`);
    }

    test('injects snippet before closing head', () => {
      const html = '<html><head><title>Test</title></head><body></body></html>';
      fs.writeFileSync(htmlPath, html, 'utf8');

      const result = injectGoogleAnalyticsIntoHtmlFile(htmlPath);
      expect(result).toBe(true);

      const updated = fs.readFileSync(htmlPath, 'utf8');
      const headClose = updated.indexOf('</head>');
      const scriptIndex = updated.indexOf(`<script async src="${GA_SCRIPT_URL}"></script>`);
      expect(scriptIndex).toBeGreaterThan(-1);
      expect(scriptIndex).toBeLessThan(headClose);
      expectSnippetPresent(updated);
    });

    test('does not inject twice when snippet already exists', () => {
      const snippet = buildGoogleAnalyticsSnippet(true);
      const html = `<html><head>${snippet}</head><body></body></html>`;
      fs.writeFileSync(htmlPath, html, 'utf8');
      expect(injectGoogleAnalyticsIntoHtmlFile(htmlPath)).toBe(false);
      const updated = fs.readFileSync(htmlPath, 'utf8');
      expectSnippetPresent(updated);
    });

    test('returns false if head tag is missing', () => {
      const html = '<html><body></body></html>';
      fs.writeFileSync(htmlPath, html, 'utf8');
      expect(injectGoogleAnalyticsIntoHtmlFile(htmlPath)).toBe(false);
    });
  });
});

describe('package-board-runtime standalone script patching', () => {
  let tmpDir;
  let appDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agx-standalone-'));
    appDir = path.join(tmpDir, 'app');
    fs.mkdirSync(appDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('rewrites standalone package scripts to use the custom server entry', () => {
    const packagePath = path.join(appDir, 'package.json');
    fs.writeFileSync(packagePath, JSON.stringify({
      scripts: {
        dev: 'next dev',
        start: 'next start',
      },
    }, null, 2));

    expect(patchStandalonePackageScripts(appDir)).toBe(true);

    const updated = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    expect(updated.scripts.dev).toBe(`node ${CUSTOM_SERVER_ENTRY}`);
    expect(updated.scripts.start).toBe(`node ${CUSTOM_SERVER_ENTRY}`);
    expect(updated.scripts.worker).toBe('node worker/index.js');
    expect(updated.scripts['daemon:worker']).toBe('node worker/index.js');
  });

  test('copies node-pty prebuilds into the standalone runtime when available', () => {
    const prebuildsSrc = path.join(tmpDir, 'prebuilds-src');
    const standaloneRoot = path.join(tmpDir, 'standalone');
    const prebuildFile = path.join(prebuildsSrc, 'darwin-arm64', 'pty.node');
    const nodePtyDest = path.join(standaloneRoot, 'node_modules', 'node-pty');

    fs.mkdirSync(path.dirname(prebuildFile), { recursive: true });
    fs.writeFileSync(prebuildFile, 'native-binary');
    fs.mkdirSync(nodePtyDest, { recursive: true });

    expect(copyNodePtyPrebuilds(standaloneRoot, prebuildsSrc)).toBe(true);
    expect(
      fs.readFileSync(path.join(nodePtyDest, 'prebuilds', 'darwin-arm64', 'pty.node'), 'utf8'),
    ).toBe('native-binary');
  });
});
