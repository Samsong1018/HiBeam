'use strict';

const REQUIRED_VARS = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'SOURCE_KEY_SECRET'];

// Returns the names (never the values) of required variables that are unset or empty.
// DB_PASSWORD may legitimately be an empty string only if it is defined; treat undefined as missing.
function missingConfig(env = process.env) {
  return REQUIRED_VARS.filter((name) => {
    const v = env[name];
    if (v === undefined || v === null) return true;
    if (name === 'DB_PASSWORD') return false;
    return String(v).trim() === '';
  });
}

// Throws an Error naming each missing variable. The message contains no values.
function assertConfig(env = process.env) {
  const missing = missingConfig(env);
  if (missing.length > 0) {
    const err = new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
    err.missing = missing;
    throw err;
  }
}

module.exports = { REQUIRED_VARS, missingConfig, assertConfig };
