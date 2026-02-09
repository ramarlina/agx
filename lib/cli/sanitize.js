function sanitizeCliArg(value) {
  return String(value ?? '').replace(/\u0000/g, '');
}

function sanitizeCliArgs(values) {
  return (values || []).map(sanitizeCliArg);
}

module.exports = { sanitizeCliArg, sanitizeCliArgs };

