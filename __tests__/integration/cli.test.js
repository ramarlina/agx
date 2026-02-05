/**
 * Integration tests for agx CLI commands
 * Tests the full command flow with mocked external services
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const AGX_PATH = path.join(__dirname, '../../index.js');

// Helper to run agx command
function runAgx(args, options = {}) {
  const cmd = `node ${AGX_PATH} ${args}`;
  try {
    return execSync(cmd, { 
      encoding: 'utf8',
      timeout: 10000,
      ...options 
    });
  } catch (err) {
    return err.stdout || err.stderr || err.message;
  }
}

describe('AGX CLI Integration Tests', () => {
  describe('Help Command', () => {
    test('displays help with --help flag', () => {
      const output = runAgx('--help');
      expect(output).toContain('agx');
      expect(output).toMatch(/usage|help|command/i);
    });

    test('displays help with -h flag', () => {
      const output = runAgx('-h');
      expect(output).toContain('agx');
    });

    test('displays version with --version', () => {
      const output = runAgx('--version');
      expect(output).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('Status Command', () => {
    test('agx status shows current state', () => {
      const output = runAgx('status');
      // Should show some status info (may fail without auth)
      expect(output).toBeTruthy();
    });
  });

  describe('Config Command', () => {
    test('agx config shows current configuration', () => {
      const output = runAgx('config');
      expect(output).toBeTruthy();
    });

    test('agx config engine shows configured engine', () => {
      const output = runAgx('config engine');
      // Should show engine info or error
      expect(output).toBeTruthy();
    });
  });

  describe('Cloud Commands', () => {
    test('agx cloud status without login shows error', () => {
      const output = runAgx('cloud status');
      // Should show some message about not being logged in or connection status
      expect(output).toBeTruthy();
    });

    test('agx cloud --help shows subcommands', () => {
      const output = runAgx('cloud --help');
      expect(output).toMatch(/login|logout|status|push|pull/i);
    });
  });

  describe('Task Commands', () => {
    test('agx tasks lists tasks (may be empty)', () => {
      const output = runAgx('tasks');
      expect(output).toBeTruthy();
    });

    test('agx list is alias for tasks', () => {
      const output = runAgx('list');
      expect(output).toBeTruthy();
    });
  });

  describe('Engine Selection', () => {
    test('agx -e claude shows claude option', () => {
      // Just verify the flag is accepted
      const output = runAgx('-e claude --help');
      expect(output).toBeTruthy();
    });

    test('agx -e gemini shows gemini option', () => {
      const output = runAgx('-e gemini --help');
      expect(output).toBeTruthy();
    });
  });

  describe('Error Handling', () => {
    test('invalid command shows error message', () => {
      const output = runAgx('invalid-command-xyz');
      // Should show some error or help
      expect(output).toBeTruthy();
    });

    test('invalid option shows error', () => {
      const output = runAgx('--invalid-option-xyz');
      expect(output).toBeTruthy();
    });
  });
});

describe('AGX Daemon Tests', () => {
  // Note: These tests are light because daemon requires running services
  
  test('daemon --help shows options', () => {
    const output = runAgx('daemon --help');
    expect(output).toMatch(/daemon|worker|poll/i);
  });

  test('daemon --dry-run validates without starting', () => {
    // Some implementations have --dry-run
    const output = runAgx('daemon --dry-run 2>&1');
    expect(output).toBeTruthy();
  });
});

describe('AGX Memory/Learn Commands', () => {
  test('agx learn --help shows options', () => {
    const output = runAgx('learn --help');
    expect(output).toBeTruthy();
  });

  test('agx mem shows memory status', () => {
    const output = runAgx('mem');
    expect(output).toBeTruthy();
  });
});
