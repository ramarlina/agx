const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  GA_MEASUREMENT_ID,
  GA_SCRIPT_URL,
  buildGoogleAnalyticsSnippet,
  injectGoogleAnalyticsIntoHtmlFile,
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
