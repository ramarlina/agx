/**
 * NDJSON event writer for agx local state storage.
 * 
 * Events are append-only, one JSON object per line.
 */

const { appendFile, ensureDir } = require('./atomic');
const path = require('path');

// ============================================================
// Event Types (for reference)
// ============================================================

/**
 * Standard event types:
 * - RUN_STARTED
 * - PROMPT_BUILT
 * - ENGINE_CALL_STARTED
 * - ENGINE_CALL_COMPLETED
 * - TOOL_CALL
 * - APPROVAL_REQUESTED
 * - APPROVAL_GRANTED
 * - APPROVAL_REJECTED
 * - STATE_UPDATED
 * - WORKING_SET_REWRITTEN
 * - RUN_FINISHED
 * - RUN_FAILED
 * - RECOVERY_DETECTED
 */

// ============================================================
// Event Writer
// ============================================================

/**
 * Append an event to an NDJSON events file.
 * @param {string} eventsPath - Path to events.ndjson file
 * @param {object} event - Event object (must have 't' field for type)
 * @returns {Promise<void>}
 */
async function appendEvent(eventsPath, event) {
    if (!event || typeof event !== 'object') {
        throw new Error('Event must be an object');
    }

    // Ensure event has timestamp if not provided
    const eventWithMeta = {
        ...event,
        at: event.at || new Date().toISOString(),
    };

    const line = JSON.stringify(eventWithMeta) + '\n';
    await appendFile(eventsPath, line);
}

/**
 * Read all events from an NDJSON file.
 * @param {string} eventsPath
 * @returns {Promise<object[]>}
 */
async function readEvents(eventsPath) {
    const fs = require('fs');

    try {
        const content = await fs.promises.readFile(eventsPath, 'utf8');
        const lines = content.trim().split('\n').filter(line => line.trim());

        return lines.map((line, index) => {
            try {
                return JSON.parse(line);
            } catch (err) {
                console.warn(`Warning: Failed to parse event at line ${index + 1}:`, err.message);
                return null;
            }
        }).filter(Boolean);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return [];
        }
        throw err;
    }
}

/**
 * Stream events from an NDJSON file, calling handler for each.
 * Useful for tailing/observing events.
 * @param {string} eventsPath
 * @param {(event: object) => void} handler
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - Signal to stop streaming
 * @returns {Promise<void>}
 */
async function streamEvents(eventsPath, handler, options = {}) {
    const fs = require('fs');
    const readline = require('readline');

    const stream = fs.createReadStream(eventsPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream });

    if (options.signal) {
        options.signal.addEventListener('abort', () => {
            rl.close();
            stream.destroy();
        });
    }

    return new Promise((resolve, reject) => {
        rl.on('line', (line) => {
            if (!line.trim()) return;
            try {
                const event = JSON.parse(line);
                handler(event);
            } catch (err) {
                console.warn('Warning: Failed to parse event line:', err.message);
            }
        });

        rl.on('close', resolve);
        rl.on('error', reject);
    });
}

// ============================================================
// Event Helpers
// ============================================================

/**
 * Create a RUN_STARTED event.
 * @param {object} params
 * @param {string} params.run_id
 * @param {string} params.stage
 * @returns {object}
 */
function runStartedEvent({ run_id, stage }) {
    return { t: 'RUN_STARTED', run_id, stage };
}

/**
 * Create a PROMPT_BUILT event.
 * @param {object} params
 * @param {object} params.sections - Per-section byte counts
 * @param {number} params.total_bytes
 * @returns {object}
 */
function promptBuiltEvent({ sections, total_bytes }) {
    return { t: 'PROMPT_BUILT', sections, total_bytes };
}

/**
 * Create an ENGINE_CALL_STARTED event.
 * @param {object} params
 * @param {string} params.trace_id
 * @param {string} params.label
 * @param {string} [params.provider]
 * @param {string} [params.model]
 * @param {string} [params.role]
 * @param {number|null} [params.pid]
 * @param {string[]} [params.args]
 * @param {number} [params.timeout_ms]
 * @param {string} [params.started_at]
 * @returns {object}
 */
function engineCallStartedEvent({ trace_id, label, provider, model, role, pid, args, timeout_ms, started_at }) {
    return {
        t: 'ENGINE_CALL_STARTED',
        trace_id,
        label,
        provider,
        model,
        role,
        pid: pid ?? null,
        args: Array.isArray(args) ? args : undefined,
        timeout_ms,
        started_at,
    };
}

/**
 * Create an ENGINE_CALL_COMPLETED event.
 * @param {object} params
 * @param {string} params.trace_id
 * @param {string} params.label
 * @param {string} [params.provider]
 * @param {string} [params.model]
 * @param {string} [params.role]
 * @param {string} params.phase - exit|error|timeout
 * @param {number|null} [params.exit_code]
 * @param {number} [params.duration_ms]
 * @param {string} [params.finished_at]
 * @param {string} [params.stdout_tail]
 * @param {string} [params.stderr_tail]
 * @param {string} [params.error]
 * @returns {object}
 */
function engineCallCompletedEvent({ trace_id, label, provider, model, role, phase, exit_code, duration_ms, finished_at, stdout_tail, stderr_tail, error }) {
    return {
        t: 'ENGINE_CALL_COMPLETED',
        trace_id,
        label,
        provider,
        model,
        role,
        phase,
        exit_code: exit_code ?? null,
        duration_ms,
        finished_at,
        stdout_tail,
        stderr_tail,
        error,
    };
}

/**
 * Create a RUN_FINISHED event.
 * @param {object} params
 * @param {string} params.status - Decision status
 * @param {string} [params.reason]
 * @returns {object}
 */
function runFinishedEvent({ status, reason }) {
    return { t: 'RUN_FINISHED', status, reason };
}

/**
 * Create a RUN_FAILED event.
 * @param {object} params
 * @param {string} params.error
 * @param {string} [params.code]
 * @returns {object}
 */
function runFailedEvent({ error, code }) {
    return { t: 'RUN_FAILED', error, code };
}

/**
 * Create an APPROVAL_REQUESTED event.
 * @param {object} params
 * @param {string} params.id
 * @param {string} params.action
 * @param {string} [params.reason]
 * @returns {object}
 */
function approvalRequestedEvent({ id, action, reason }) {
    return { t: 'APPROVAL_REQUESTED', id, action, reason };
}

/**
 * Create an APPROVAL_GRANTED event.
 * @param {object} params
 * @param {string} params.id
 * @returns {object}
 */
function approvalGrantedEvent({ id }) {
    return { t: 'APPROVAL_GRANTED', id };
}

/**
 * Create an APPROVAL_REJECTED event.
 * @param {object} params
 * @param {string} params.id
 * @param {string} [params.reason]
 * @returns {object}
 */
function approvalRejectedEvent({ id, reason }) {
    return { t: 'APPROVAL_REJECTED', id, reason };
}

/**
 * Create a TOOL_CALL event.
 * @param {object} params
 * @param {string} params.tool
 * @param {string} [params.summary]
 * @param {number} [params.duration_ms]
 * @returns {object}
 */
function toolCallEvent({ tool, summary, duration_ms }) {
    return { t: 'TOOL_CALL', tool, summary, duration_ms };
}

/**
 * Create a RECOVERY_DETECTED event.
 * @param {object} params
 * @param {string} params.incomplete_run_id
 * @param {string} params.stage
 * @returns {object}
 */
function recoveryDetectedEvent({ incomplete_run_id, stage }) {
    return { t: 'RECOVERY_DETECTED', incomplete_run_id, stage };
}

/**
 * Create a STATE_UPDATED event.
 * @param {object} params
 * @param {string} params.field - Field that was updated
 * @param {any} [params.old_value]
 * @param {any} [params.new_value]
 * @returns {object}
 */
function stateUpdatedEvent({ field, old_value, new_value }) {
    return { t: 'STATE_UPDATED', field, old_value, new_value };
}

/**
 * Create a WORKING_SET_REWRITTEN event.
 * @param {object} params
 * @param {number} params.original_bytes
 * @param {number} params.new_bytes
 * @param {string} [params.reason]
 * @returns {object}
 */
function workingSetRewrittenEvent({ original_bytes, new_bytes, reason }) {
    return { t: 'WORKING_SET_REWRITTEN', original_bytes, new_bytes, reason };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
    // Core functions
    appendEvent,
    readEvents,
    streamEvents,

    // Event factories
    runStartedEvent,
    promptBuiltEvent,
    engineCallStartedEvent,
    engineCallCompletedEvent,
    runFinishedEvent,
    runFailedEvent,
    approvalRequestedEvent,
    approvalGrantedEvent,
    approvalRejectedEvent,
    toolCallEvent,
    recoveryDetectedEvent,
    stateUpdatedEvent,
    workingSetRewrittenEvent,
};
