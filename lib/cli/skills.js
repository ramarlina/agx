/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const { c } = require('../ui/colors');
const { AGX_SKILL } = require('./skillText');
const { detectProviders } = require('./providers');

function isSkillInstalled(provider) {
  const skillDir = path.join(
    process.env.HOME || process.env.USERPROFILE,
    provider === 'claude' ? '.claude' : '.gemini',
    'skills',
    'agx'
  );
  return fs.existsSync(path.join(skillDir, 'SKILL.md'));
}

function installSkillTo(provider) {
  const baseDir = path.join(
    process.env.HOME || process.env.USERPROFILE,
    provider === 'claude' ? '.claude' : '.gemini',
    'skills',
    'agx'
  );

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  fs.writeFileSync(path.join(baseDir, 'SKILL.md'), AGX_SKILL);
  return baseDir;
}

async function handleSkillCommand(args) {
  const subCmd = args[1];

  if (!subCmd || subCmd === 'view' || subCmd === 'show') {
    console.log(`\n${c.bold}${c.cyan}/agx${c.reset} - ${c.dim}LLM instructions for using agx${c.reset}\n`);

    const claudeInstalled = isSkillInstalled('claude');
    const geminiInstalled = isSkillInstalled('gemini');

    if (claudeInstalled || geminiInstalled) {
      console.log(`${c.green}Installed:${c.reset}`);
      if (claudeInstalled) console.log(`  ${c.dim}~/.claude/skills/agx/SKILL.md${c.reset}`);
      if (geminiInstalled) console.log(`  ${c.dim}~/.gemini/skills/agx/SKILL.md${c.reset}`);
      console.log('');
    }

    console.log(c.dim + '─'.repeat(60) + c.reset);
    console.log(AGX_SKILL);
    console.log(c.dim + '─'.repeat(60) + c.reset);

    if (!claudeInstalled && !geminiInstalled) {
      console.log(`\n${c.dim}Install with: ${c.reset}agx skill install`);
    }
    console.log('');
    return;
  }

  if (subCmd === 'install' || subCmd === 'add') {
    const target = args[2];

    console.log(`\n${c.bold}Install agx skill${c.reset}\n`);

    if (!target || target === 'all') {
      const providers = detectProviders();
      let installed = 0;

      if (providers.claude) {
        const dest = installSkillTo('claude');
        console.log(`${c.green}✓${c.reset} Installed to ${c.dim}${dest}${c.reset}`);
        installed += 1;
      }

      if (providers.gemini) {
        const dest = installSkillTo('gemini');
        console.log(`${c.green}✓${c.reset} Installed to ${c.dim}${dest}${c.reset}`);
        installed += 1;
      }

      if (installed === 0) {
        console.log(`${c.yellow}No providers installed.${c.reset} Run ${c.cyan}agx init${c.reset} first.`);
      } else {
        console.log(`\n${c.dim}LLMs can now use /agx to learn how to run agx commands.${c.reset}\n`);
      }
    } else if (target === 'claude' || target === 'gemini') {
      const dest = installSkillTo(target);
      console.log(`${c.green}✓${c.reset} Installed to ${c.dim}${dest}${c.reset}`);
      console.log(`\n${c.dim}LLMs can now use /agx to learn how to run agx commands.${c.reset}\n`);
    } else {
      console.log(`${c.yellow}Unknown target:${c.reset} ${target}`);
      console.log(`${c.dim}Usage: agx skill install [claude|gemini|all]${c.reset}\n`);
    }
    return;
  }

  console.log(`${c.bold}agx skill${c.reset} - Manage the agx skill for LLMs\n`);
  console.log(`${c.dim}Commands:${c.reset}`);
  console.log(`  ${c.cyan}agx skill${c.reset}              View the skill content`);
  console.log(`  ${c.cyan}agx skill install${c.reset}      Install to all providers`);
  console.log(`  ${c.cyan}agx skill install claude${c.reset}  Install to Claude only`);
  console.log('');
}

module.exports = { handleSkillCommand };

