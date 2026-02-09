// Jest's node environment teardown enumerates and clears globals.
// On recent Node versions, accessing globalThis.localStorage/sessionStorage
// can emit a warning unless Node is started with a valid --localstorage-file.
// Override these accessors up front to keep test output clean and deterministic.

function tryOverride(name) {
  try {
    Object.defineProperty(globalThis, name, {
      value: undefined,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch {
    // Best-effort only; never break tests if Node makes these non-configurable.
  }
}

tryOverride('localStorage');
tryOverride('sessionStorage');

