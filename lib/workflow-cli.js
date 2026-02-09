'use strict';

/**
 * Workflow CLI module - handles workflow listing and viewing commands
 */

async function listWorkflows(cloudRequestFn) {
    if (typeof cloudRequestFn !== 'function') {
        throw new Error('cloudRequest function is required to list workflows');
    }
    return cloudRequestFn('GET', '/api/workflows');
}

async function showWorkflow(id, cloudRequestFn) {
    if (!id) {
        throw new Error('Workflow ID is required');
    }
    if (typeof cloudRequestFn !== 'function') {
        throw new Error('cloudRequest function is required to show workflow');
    }
    return cloudRequestFn('GET', `/api/workflows/${id}`);
}

function formatWorkflowList(workflows, defaultId) {
    if (!workflows || workflows.length === 0) {
        return 'No workflows available.';
    }

    const lines = ['Available Workflows:', ''];
    for (const wf of workflows) {
        const isDefault = wf.id === defaultId ? ' (default)' : '';
        const desc = wf.definition?.description || wf.name;
        lines.push(`  ${wf.id}  ${wf.name}${isDefault}`);
        if (desc && desc !== wf.name) {
            lines.push(`    ${desc}`);
        }
    }
    return lines.join('\n');
}

function formatWorkflowDetail(workflow) {
    if (!workflow) {
        return 'Workflow not found.';
    }

    const lines = [
        `Workflow: ${workflow.name}`,
        `ID: ${workflow.id}`,
        `Type: ${workflow.definition?.type || 'custom'}`,
        '',
        'Nodes:',
    ];

    const nodes = workflow.nodes || [];
    const transitions = workflow.transitions || [];

    for (const node of nodes) {
        const label = node.label || node.name;
        const nodeType = node.node_type !== 'step' ? ` [${node.node_type}]` : '';
        lines.push(`  ${node.position}. ${label}${nodeType}`);
        if (node.prompt) {
            const shortPrompt = node.prompt.length > 60 ? node.prompt.slice(0, 57) + '...' : node.prompt;
            lines.push(`     Prompt: ${shortPrompt}`);
        }

        // Find outgoing transitions
        const outgoing = transitions.filter(t => t.from_node_id === node.id);
        if (outgoing.length > 0) {
            for (const t of outgoing) {
                const targetNode = nodes.find(n => n.id === t.to_node_id);
                const targetName = targetNode?.label || targetNode?.name || t.to_node_id;
                lines.push(`     → ${t.condition}: ${targetName}`);
            }
        }
    }

    return lines.join('\n');
}

async function handleWorkflowCommand(args, cloudRequestFn) {
    const subcommand = args[0];
    const subArgs = args.slice(1);

    switch (subcommand) {
        case 'list':
        case 'ls':
            const listResult = await listWorkflows(cloudRequestFn);
            console.log(formatWorkflowList(listResult.workflows, listResult.default_workflow_id));
            return listResult;

        case 'show':
        case 'get':
            const id = subArgs[0];
            if (!id) {
                console.error('Usage: agx workflow show <workflow-id>');
                process.exit(1);
            }
            const showResult = await showWorkflow(id, cloudRequestFn);
            console.log(formatWorkflowDetail(showResult.workflow));
            return showResult;

        case 'help':
        case undefined:
            console.log(`
Workflow Commands:
  agx workflow list       List available workflows
  agx workflow show <id>  Show workflow details with nodes and transitions
`);
            return;

        default:
            console.error(`Unknown workflow subcommand: ${subcommand}`);
            console.error('Run "agx workflow help" for usage.');
            process.exit(1);
    }
}

module.exports = {
    listWorkflows,
    showWorkflow,
    formatWorkflowList,
    formatWorkflowDetail,
    handleWorkflowCommand,
};
