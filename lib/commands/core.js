async function maybeHandleCoreCommand({ cmd, args, ctx }) {
  const {
    c,
    runOnboarding,
    runConfigMenu,
    showConfigStatus,
    handleSkillCommand,
    loadConfig,
    prompt,
    installProvider,
    loginProvider,
    commandExists,
  } = ctx;

  // Init/setup command
  if (cmd === 'init' || cmd === 'setup') {
    await runOnboarding();
    return true;
  }

  // Config menu
  if (cmd === 'config') {
    await runConfigMenu();
    return true;
  }

  // Status command — if a task identifier is given, let the cloud status handler deal with it
  if (cmd === 'status') {
    const taskArg = args[1];
    if (taskArg && !taskArg.startsWith('-')) {
      return false; // fall through to cloud task status handler
    }

    if (args.includes('--cloud')) {
      console.log(`${c.yellow}Note:${c.reset} ${c.cyan}--cloud${c.reset} is no longer needed. Cloud is the default.`);
    }

    await showConfigStatus();
    process.exit(0);
    return true;
  }

  // Skill command
  if (cmd === 'skill') {
    await handleSkillCommand(args);
    process.exit(0);
    return true;
  }

  // Add/install command
  if (cmd === 'add' || cmd === 'install') {
    const provider = args[1];
    if (!provider) {
      console.log(`${c.yellow}Usage:${c.reset} agx add <provider>`);
      console.log(`${c.dim}Providers: claude, gemini, ollama, codex${c.reset}`);
      process.exit(1);
    }
    if (!['claude', 'gemini', 'ollama', 'codex'].includes(provider)) {
      console.log(`${c.red}Unknown provider:${c.reset} ${provider}`);
      process.exit(1);
    }
    if (commandExists(provider)) {
      console.log(`${c.green}✓${c.reset} ${provider} is already installed!`);
      const answer = await prompt(`Run login/setup? [Y/n]: `);
      if (answer.toLowerCase() !== 'n') {
        await loginProvider(provider);
      }
    } else {
      const success = await installProvider(provider);
      if (success) {
        const answer = await prompt(`\nRun login/setup? [Y/n]: `);
        if (answer.toLowerCase() !== 'n') {
          await loginProvider(provider);
        }
      }
    }
    process.exit(0);
    return true;
  }

  // First run detection remains in index_new.js (needs full context).
  void loadConfig;
  return false;
}

module.exports = { maybeHandleCoreCommand };

