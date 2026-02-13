'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('templates module', () => {
  const originalEnv = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
  };
  let tmpHome;
  let templates;

  const reloadModules = () => {
    jest.resetModules();
    templates = require('../../lib/templates');
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agx-templates-test-'));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    reloadModules();
  });

  afterEach(() => {
    jest.resetModules();
    process.env.HOME = originalEnv.HOME;
    process.env.USERPROFILE = originalEnv.USERPROFILE;
    if (tmpHome && fs.existsSync(tmpHome)) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test('creates, lists, and loads saved templates', async () => {
    const { createTemplate, listTemplates, loadTemplate, getTemplatesDir } = templates;
    const baseTemplate = {
      name: 'Beta template',
      description: 'Second template',
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      content: '# Beta\n\nSteps for beta template.',
    };
    const earlyTemplate = {
      name: 'Alpha template',
      description: 'First template',
      provider: 'gemini',
      model: 'gemini-1.0',
      content: '# Alpha\n\nSteps for alpha template.',
    };

    await createTemplate(baseTemplate);
    const createdEarly = await createTemplate(earlyTemplate);

    const templatesList = await listTemplates();
    expect(templatesList.map(t => t.name)).toEqual(['Alpha template', 'Beta template']);

    const stored = await loadTemplate(createdEarly.slug);
    expect(stored.slug).toBe(createdEarly.slug);
    expect(stored.provider).toBe('gemini');
    expect(stored.model).toBe('gemini-1.0');
    expect(stored.content.trim()).toContain('Alpha');

    const expectedPath = path.join(getTemplatesDir(), `${createdEarly.slug}.yaml`);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  test('renderTemplateContent replaces placeholders safely', () => {
    const { renderTemplateContent } = templates;
    const template = 'Goal: {{title}}\nProject: {{project}}\nSlug: {{slug}}\n{{missing}}';
    const context = { title: 'Fix login', project: 'api', slug: 'fix-login' };
    const result = renderTemplateContent(template, context);
    expect(result).toContain('Goal: Fix login');
    expect(result).toContain('Project: api');
    expect(result).toContain('Slug: fix-login');
    expect(result.trim().endsWith('Slug: fix-login')).toBe(true);
    expect(renderTemplateContent('Empty {{missing}} field', null)).toBe('Empty  field');
  });
});
