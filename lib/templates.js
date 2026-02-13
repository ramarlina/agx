'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { CONFIG_DIR } = require('./config/paths');
const { slugify } = require('./storage/paths');

const TEMPLATES_DIR = path.join(CONFIG_DIR, 'templates');
const TEMPLATE_EXTENSIONS = ['.yaml', '.yml'];

function getTemplatesDir() {
    return TEMPLATES_DIR;
}

async function ensureTemplatesDir() {
    await fs.promises.mkdir(TEMPLATES_DIR, { recursive: true });
}

function normalizeTemplateSlug(name) {
    if (!name || typeof name !== 'string') {
        throw new Error('Template name is required');
    }
    const slug = slugify(name, { maxLength: 64 });
    if (!slug) {
        throw new Error('Template name must contain letters or numbers');
    }
    return slug;
}

function templateFilePath(slug) {
    return path.join(TEMPLATES_DIR, `${slug}.yaml`);
}

async function readTemplateFile(filePath) {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const parsed = yaml.parse(raw) || {};
    return parsed;
}

function normalizeTemplateObject(slug, raw) {
    return {
        slug,
        name: raw.name || slug,
        description: raw.description || '',
        provider: raw.provider || null,
        model: raw.model || null,
        content: typeof raw.content === 'string' ? raw.content : '',
        file: templateFilePath(slug),
    };
}

async function createTemplate({ name, description = '', provider = '', model = '', content = '' }) {
    const slug = normalizeTemplateSlug(name);
    await ensureTemplatesDir();
    const filePath = templateFilePath(slug);
    if (fs.existsSync(filePath)) {
        throw new Error(`Template "${slug}" already exists`);
    }

    const displayName = typeof name === 'string' && name.trim()
        ? name.trim()
        : slug;
    const payload = {
        name: displayName,
        description: description || `Template ${displayName}`,
        provider: provider || undefined,
        model: model || undefined,
        content: content || '# {{title}}\n\nDescribe the workflow here.\n',
    };

    const serialized = yaml.stringify(payload).trim() + '\n';
    await fs.promises.writeFile(filePath, serialized, 'utf8');
    return { slug, file: filePath };
}

async function listTemplates() {
    await ensureTemplatesDir();
    const entries = await fs.promises.readdir(TEMPLATES_DIR, { withFileTypes: true });
    const templates = [];
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!TEMPLATE_EXTENSIONS.includes(ext)) continue;
        const slug = normalizeTemplateSlug(path.basename(entry.name, ext));
        try {
            const data = await readTemplateFile(path.join(TEMPLATES_DIR, entry.name));
            templates.push(normalizeTemplateObject(slug, data));
        } catch (err) {
            // skip invalid templates
        }
    }

    return templates.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadTemplate(name) {
    const slug = normalizeTemplateSlug(name);
    const filePath = templateFilePath(slug);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Template "${slug}" not found`);
    }
    const raw = await readTemplateFile(filePath);
    return normalizeTemplateObject(slug, raw);
}

function renderTemplateContent(content, context = {}) {
    if (!content || typeof content !== 'string') return '';
    return content.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (match, key) => {
        const value = context && typeof context === 'object' ? context[key] : undefined;
        if (value === undefined || value === null) return '';
        return String(value);
    });
}

module.exports = {
    getTemplatesDir,
    createTemplate,
    listTemplates,
    loadTemplate,
    renderTemplateContent,
    ensureTemplatesDir,
};
