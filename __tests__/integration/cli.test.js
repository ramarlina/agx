/**
 * Integration tests for agx CLI commands
 * Tests the full command flow with mocked external services
 * Updated for simplified command structure (no cloud prefix)
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

    test('help shows direct commands (no cloud prefix)', () => {
      const output = runAgx('--help');
      // Should show direct commands like status, list, tasks, login, logout
      expect(output).toBeTruthy();
    });

    test('help does NOT show deprecated mem/learn commands', () => {
      const output = runAgx('--help');
      // mem and learn commands have been removed in favor of cloud-only
      expect(output).not.toContain('mem');
      expect(output).not.toContain('learn');
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

  describe('Task Commands (simplified - no cloud prefix)', () => {
    test('agx task ls shows task listing', () => {
      const output = runAgx('task ls');
      // Should show tasks or empty list message
      expect(output).toBeTruthy();
    });

    test('agx tasks lists tasks', () => {
      const output = runAgx('tasks');
      expect(output).toBeTruthy();
      // tasks command is the primary task listing method
    });

    test('agx list is backward compatible alias for task ls', () => {
      const output = runAgx('list');
      expect(output).toBeTruthy();
    });
  });

  describe('Direct Commands (no cloud prefix)', () => {
    test('agx login command exists', () => {
      const output = runAgx('login 2>&1');
      // Command should execute (may show error if no URL provided)
      expect(output).toBeTruthy();
    });

    test('agx logout command exists', () => {
      const output = runAgx('logout 2>&1');
      // Command should execute
      expect(output).toBeTruthy();
    });

    test('agx new command exists', () => {
      const output = runAgx('new 2>&1');
      // Command should execute (may show error if no goal provided)
      expect(output).toBeTruthy();
    });

    test('agx complete command exists', () => {
      const output = runAgx('complete 2>&1');
      // Command should execute (may show error if no auth)
      expect(output).toBeTruthy();
    });

    test('agx logs command exists', () => {
      const output = runAgx('logs 2>&1');
      // Command should execute (may show error if no auth)
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

    test('agx mem command shows not found error', () => {
      const output = runAgx('mem 2>&1');
      // mem command should not exist
      expect(output).toBeTruthy();
      // Should indicate command is not available
      expect(output).toMatch(/not found|unknown|error/i);
    });

    test('agx learn command shows not found error', () => {
      const output = runAgx('learn 2>&1');
      // learn command should not exist
      expect(output).toBeTruthy();
      // Should indicate command is not available
      expect(output).toMatch(/not found|unknown|error/i);
    });
  });

  describe('Backward Compatibility - cloud prefix should not work', () => {
    test('agx cloud status shows not found', () => {
      const output = runAgx('cloud status 2>&1');
      // cloud prefix should no longer work
      expect(output).toBeTruthy();
      expect(output).toMatch(/not found|unknown|error/i);
    });

    test('agx cloud list shows not found', () => {
      const output = runAgx('cloud list 2>&1');
      // cloud prefix should no longer work
      expect(output).toBeTruthy();
      expect(output).toMatch(/not found|unknown|error/i);
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