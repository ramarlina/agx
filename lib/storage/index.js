/**
 * agx Local State Storage
 * 
 * Main entry point for the storage module.
 * Re-exports all public APIs from submodules.
 */

const paths = require('./paths');
const atomic = require('./atomic');
const locks = require('./locks');
const events = require('./events');
const state = require('./state');
const runs = require('./runs');
const checkpoints = require('./checkpoints');
const promptBuilder = require('./prompt_builder');
const git = require('./git');
const graph = require('./graph');
const db = require('./db');

module.exports = {
    // Paths
    ...paths,

    // Atomic file operations
    ...atomic,

    // Locking
    ...locks,

    // Events
    ...events,

    // State management
    ...state,

    // Runs
    ...runs,

    // Checkpoints
    ...checkpoints,

    // Graph serialization
    ...graph,

    // SQLite DB
    ...db,

    // Prompt builder
    ...promptBuilder,

    // Namespaced exports for explicit access
    paths,
    atomic,
    locks,
    events,
    state,
    runs,
    checkpoints,
    graph,
    promptBuilder,
    git,
    db,
};
