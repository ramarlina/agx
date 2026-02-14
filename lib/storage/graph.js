/**
 * Execution graph serialization helpers for agx local state storage.
 *
 * Persists the full v2 execution graph as task-local graph.json.
 */

const fs = require('fs');
const path = require('path');
const { graphJsonPath } = require('./paths');
const { ensureDir, readJsonSafe, writeJsonAtomic } = require('./atomic');

function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function validateGraphShape(graph) {
    if (!isObject(graph)) {
        throw new Error('graph must be an object');
    }
    if (typeof graph.id !== 'string' || !graph.id.trim()) {
        throw new Error('graph.id is required');
    }
    if (typeof graph.taskId !== 'string' || !graph.taskId.trim()) {
        throw new Error('graph.taskId is required');
    }
    if (!isObject(graph.nodes)) {
        throw new Error('graph.nodes must be an object');
    }
    if (!Array.isArray(graph.edges)) {
        throw new Error('graph.edges must be an array');
    }
}

/**
 * Read a task execution graph.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @returns {Promise<object|null>}
 */
async function readTaskGraph(projectSlug, taskSlug) {
    return readJsonSafe(graphJsonPath(projectSlug, taskSlug));
}

/**
 * Write a task execution graph.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {object} graph
 * @returns {Promise<object>}
 */
async function writeTaskGraph(projectSlug, taskSlug, graph) {
    validateGraphShape(graph);
    const filePath = graphJsonPath(projectSlug, taskSlug);
    await ensureDir(path.dirname(filePath));
    await writeJsonAtomic(filePath, graph);
    return graph;
}

/**
 * Delete a task execution graph file if present.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @returns {Promise<void>}
 */
async function deleteTaskGraph(projectSlug, taskSlug) {
    const filePath = graphJsonPath(projectSlug, taskSlug);
    try {
        await fs.promises.unlink(filePath);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }
    }
}

module.exports = {
    readTaskGraph,
    writeTaskGraph,
    deleteTaskGraph,
};
