'use strict';

const fs = require('fs');
const path = require('path');
const { listTemplates, createTemplate, getTemplatesDir } = require('../templates');

function getFlagValue(args, flag) {
    const idx = args.findIndex(a => a === flag);
    if (idx === -1) return null;
    return args[idx + 1] || null;
}

async function maybeHandleTemplateCommand({ cmd, args, ctx }) {
    if (cmd !== 'templates') {
        return false;
    }
    const { c } = ctx || {};
    const subcommand = args[1];

    switch (subcommand) {
        case 'list':
        case 'ls': {
            const templates = await listTemplates();
            if (args.includes('--json')) {
                console.log(JSON.stringify({ templates }));
                process.exit(0);
            }
            console.log(`${c?.bold || ''}Templates (${templates.length})${c?.reset || ''}`);
            console.log(`Directory: ${getTemplatesDir()}`);
            if (!templates.length) {
                console.log('  No templates found. Use `agx templates create <name>` to add one.');
                process.exit(0);
            }
            console.log('');
            for (const template of templates) {
                const info = [];
                if (template.description) info.push(template.description);
                if (template.provider) info.push(`provider=${template.provider}`);
                if (template.model) info.push(`model=${template.model}`);
                const displayName = template.name === template.slug
                    ? template.slug
                    : `${template.name} (${template.slug})`;
                console.log(`  ${displayName}${info.length ? `  (${info.join(', ')})` : ''}`);
            }
            process.exit(0);
        }
        case 'create': {
            const name = args[2];
            if (!name) {
                console.log('Usage: agx templates create <name> [--description "desc"] [--provider claude] [--model claude-sonnet-4-5] [--content-file ./template.md]');
                process.exit(1);
            }

            const description = getFlagValue(args, '--description');
            const provider = getFlagValue(args, '--provider');
            const model = getFlagValue(args, '--model');
            const contentInline = getFlagValue(args, '--content');
            const contentFile = getFlagValue(args, '--content-file');
            let content = contentInline;
            if (!content && contentFile) {
                try {
                    content = await fs.promises.readFile(path.resolve(contentFile), 'utf8');
                } catch (err) {
                    console.log(`${c?.red || ''}Error:${c?.reset || ''} Could not read content file: ${err.message}`);
                    process.exit(1);
                }
            }

            const created = await createTemplate({ name, description, provider, model, content });
            console.log(`${c?.green || ''}✓${c?.reset || ''} Template created: ${created.slug}`);
            console.log(`  Path: ${created.file}`);
            process.exit(0);
        }
        default:
            console.log(`Template Commands:
  agx templates list   List available templates
  agx templates create <name>  Scaffold a new template file (options: --description, --provider, --model, --content-file)
`);
            process.exit(0);
    }
}

module.exports = { maybeHandleTemplateCommand };
