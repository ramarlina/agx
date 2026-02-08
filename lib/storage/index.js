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
const promptBuilder = require('./prompt_builder');

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

    // Prompt builder
    ...promptBuilder,

    // Namespaced exports for explicit access
    paths,
    atomic,
    locks,
    events,
    state,
    runs,
    promptBuilder,
};
