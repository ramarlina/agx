const execa = require('execa');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AGX_PATH = path.join(__dirname, '../../index.js');

describe('non-interactive postgres bootstrap', () => {
  test('agx new exits with actionable error when docker is unavailable', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agx-noninteractive-'));
    try {
      const result = execa.sync(process.execPath, [AGX_PATH, 'new', 'sample task'], {
        encoding: 'utf8',
        reject: false,
        timeout: 20000,
        env: {
          ...process.env,
          HOME: tempHome,
          AGX_CLOUD_URL: 'http://localhost:59999',
          AGX_TELEMETRY: '0',
          PATH: '/definitely-missing-path',
        },
      });

      const output = `${String(result.stdout || '')}\n${String(result.stderr || '')}`;
      expect(result.exitCode).toBe(1);
      expect(output).toMatch(/Unable to bootstrap local Postgres/i);
      expect(output).toMatch(/DATABASE_URL/);
      expect(output).toMatch(/AGX_CLOUD_URL/);
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
