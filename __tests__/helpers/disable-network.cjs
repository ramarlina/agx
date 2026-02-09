// Loaded via NODE_OPTIONS=--require to hard-fail any outbound network usage in tests.
// This is intentionally blunt: local-mode CLI/storage paths should not need the network.

const http = require('http');
const https = require('https');
const net = require('net');

function makeError() {
  const err = new Error('Network disabled by test');
  err.code = 'AGX_TEST_NETWORK_DISABLED';
  return err;
}

function thrower() {
  throw makeError();
}

function rejecter() {
  return Promise.reject(makeError());
}

// Block fetch (Node 18+ global fetch via undici).
global.fetch = rejecter;

// Block common HTTP(S) entrypoints.
http.request = thrower;
http.get = thrower;
https.request = thrower;
https.get = thrower;

// Block raw TCP connects (covers a lot of client libs).
net.connect = thrower;
net.createConnection = thrower;

