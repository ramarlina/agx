/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const { c } = require('../ui/colors');
const { detectProviders } = require('./providers');

const SKILLS_DIR = path.join(__dirname, '../../skills');

function listBundledSkills() {
  try {
    return fs.readdirSync(SKILLS_DIR).filter((d) => {
      const p = path.join(SKILLS_DIR, d, 'SKILL.md');
      return fs.existsSync(p);
    });
  } catch {
    return ['agx'];
  }
}

function readSkillContent(skillName) {
  const p = path.join(SKILLS_DIR, skillName, 'SKILL.md');
  return fs.readFileSync(p, 'utf8');
}

function getSkillDir(provider, skillName) {
  const home = process.env.HOME || process.env.USERPROFILE;
  const base = {
    claude: '.claude',
    gemini: '.gemini',
    codex: '.codex',
  }[provider];
  if (!base) return null;
  return path.join(home, base, 'skills', skillName);
}

function isSkillInstalled(provider, skillName) {
  const dir = getSkillDir(provider, skillName);
  return dir && fs.existsSync(path.join(dir, 'SKILL.md'));
}

function installSkillTo(provider, skillName) {
  const dir = getSkillDir(provider, skillName);
  if (!dir) return null;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = readSkillContent(skillName);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  return dir;
}

function installAllSkillsTo(provider) {
  const skills = listBundledSkills();
  const results = [];
  for (const skill of skills) {
    const dest = installSkillTo(provider, skill);
    if (dest) results.push({ skill, dest });
  }
  return results;
}

async function handleSkillCommand(args) {
  const subCmd = args[1];
  const skills = listBundledSkills();

  if (!subCmd || subCmd === 'view' || subCmd === 'show') {
    const skillName = args[2] || 'agx';

    if (!skills.includes(skillName)) {
      console.log(`\n${c.red}Unknown skill:${c.reset} ${skillName}`);
      console.log(`${c.dim}Available: ${skills.join(', ')}${c.reset}\n`);
      return;
    }

    console.log(`\n${c.bold}${c.cyan}/${skillName}${c.reset} - ${c.dim}LLM instructions${c.reset}\n`);

    const providers = ['claude', 'gemini', 'codex'];
    const installed = providers.filter((p) => isSkillInstalled(p, skillName));
    if (installed.length) {
      console.log(`${c.green}Installed:${c.reset}`);
      for (const p of installed) {
        console.log(`  ${c.dim}${getSkillDir(p, skillName)}/SKILL.md${c.reset}`);
      }
      console.log('');
    }

    console.log(c.dim + '\u2500'.repeat(60) + c.reset);
    console.log(readSkillContent(skillName));
    console.log(c.dim + '\u2500'.repeat(60) + c.reset);

    if (!installed.length) {
      console.log(`\n${c.dim}Install with: ${c.reset}agx skill install`);
    }
    console.log('');
    return;
  }

  if (subCmd === 'list' || subCmd === 'ls') {
    console.log(`\n${c.bold}Bundled skills:${c.reset}\n`);
    for (const skill of skills) {
      const providers = ['claude', 'gemini', 'codex'];
      const installed = providers.filter((p) => isSkillInstalled(p, skill));
      const status = installed.length
        ? `${c.green}✓${c.reset} ${c.dim}(${installed.join(', ')})${c.reset}`
        : `${c.dim}not installed${c.reset}`;
      console.log(`  ${c.cyan}/${skill}${c.reset}  ${status}`);
    }
    console.log(`\n${c.dim}Install all: ${c.reset}agx skill install\n`);
    return;
  }

  if (subCmd === 'install' || subCmd === 'add') {
    const target = args[2];

    console.log(`\n${c.bold}Install agx skills${c.reset}\n`);

    if (!target || target === 'all') {
      const providers = detectProviders();
      let installed = 0;

      for (const [name, available] of Object.entries(providers)) {
        if (!available) continue;
        if (!getSkillDir(name, 'agx')) continue; // provider not supported for skills
        const results = installAllSkillsTo(name);
        for (const { skill, dest } of results) {
          console.log(`${c.green}✓${c.reset} ${c.cyan}/${skill}${c.reset} → ${c.dim}${dest}${c.reset}`);
        }
        installed += results.length;
      }

      if (installed === 0) {
        console.log(`${c.yellow}No providers installed.${c.reset} Run ${c.cyan}agx init${c.reset} first.`);
      } else {
        console.log(`\n${c.dim}${installed} skill(s) installed. Use /${skills.join(', /')} in your LLM.${c.reset}\n`);
      }
    } else if (['claude', 'gemini', 'codex'].includes(target)) {
      const results = installAllSkillsTo(target);
      for (const { skill, dest } of results) {
        console.log(`${c.green}✓${c.reset} ${c.cyan}/${skill}${c.reset} → ${c.dim}${dest}${c.reset}`);
      }
      console.log(`\n${c.dim}${results.length} skill(s) installed. Use /${skills.join(', /')} in your LLM.${c.reset}\n`);
    } else {
      console.log(`${c.yellow}Unknown target:${c.reset} ${target}`);
      console.log(`${c.dim}Usage: agx skill install [claude|gemini|codex|all]${c.reset}\n`);
    }
    return;
  }

  console.log(`${c.bold}agx skill${c.reset} - Manage agx skills for LLMs\n`);
  console.log(`${c.dim}Commands:${c.reset}`);
  console.log(`  ${c.cyan}agx skill${c.reset}                View the agx skill`);
  console.log(`  ${c.cyan}agx skill view <name>${c.reset}    View a specific skill`);
  console.log(`  ${c.cyan}agx skill ls${c.reset}             List all bundled skills`);
  console.log(`  ${c.cyan}agx skill install${c.reset}        Install all skills to detected providers`);
  console.log(`  ${c.cyan}agx skill install claude${c.reset} Install to Claude only`);
  console.log(`  ${c.cyan}agx skill install codex${c.reset}  Install to Codex only`);
  console.log('');
}

module.exports = { handleSkillCommand };
