'use strict';

function applyTemplateDefaults({
    provider,
    model,
    template,
    providerArgProvided,
    modelArgProvided,
    defaultProvider,
}) {
    let resolvedProvider = provider;
    if (!providerArgProvided) {
        resolvedProvider = template?.provider || defaultProvider || 'claude';
    }
    let resolvedModel = model;
    if (!modelArgProvided) {
        resolvedModel = template?.model || model;
    }
    return { provider: resolvedProvider, model: resolvedModel };
}

module.exports = { applyTemplateDefaults };
