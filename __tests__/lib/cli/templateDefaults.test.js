const { applyTemplateDefaults } = require('../../../lib/cli/templateDefaults');

describe('applyTemplateDefaults', () => {
  test('respects explicit provider/model flags', () => {
    const result = applyTemplateDefaults({
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      template: {
        provider: 'gemini',
        model: 'gemini-1.0',
      },
      providerArgProvided: true,
      modelArgProvided: true,
      defaultProvider: 'claude',
    });
    expect(result.provider).toBe('claude');
    expect(result.model).toBe('claude-sonnet-4-5');
  });

  test('falls back to template defaults when flags omitted', () => {
    const result = applyTemplateDefaults({
      provider: undefined,
      model: undefined,
      template: {
        provider: 'gemini',
        model: 'gemini-1.0',
      },
      providerArgProvided: false,
      modelArgProvided: false,
      defaultProvider: 'claude',
    });
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-1.0');
  });

  test('uses configured default provider when no template overrides', () => {
    const result = applyTemplateDefaults({
      provider: undefined,
      model: undefined,
      template: null,
      providerArgProvided: false,
      modelArgProvided: false,
      defaultProvider: 'ollama',
    });
    expect(result.provider).toBe('ollama');
    expect(result.model).toBeUndefined();
  });
});
