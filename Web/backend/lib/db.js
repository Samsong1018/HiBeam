'use strict';

const mysql = require('mysql');

let pool = null;

// The pool is created on first use. mysql.createPool does not connect until a query runs,
// so requiring this module never touches the database.
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      connectionLimit: 10,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
  }
  return pool;
}

// Test hook: inject a pool-like object ({ query, getConnection, end }) or null to reset.
function setPool(p) {
  pool = p;
}

// Values must be passed via `params` and referenced with `?` placeholders in `sql`.
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    getPool().query(sql, params, (err, results, fields) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

function connQuery(conn, sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
  });
}

function call(conn, method) {
  return new Promise((resolve, reject) => {
    conn[method]((err) => (err ? reject(err) : resolve()));
  });
}

// Runs fn(tx) in a transaction on one connection. tx.query(sql, params) is promise-based.
// Commits on success; rolls back and rethrows the original error on failure.
async function withTransaction(fn) {
  const conn = await new Promise((resolve, reject) => {
    getPool().getConnection((err, c) => (err ? reject(err) : resolve(c)));
  });
  try {
    await call(conn, 'beginTransaction');
    let result;
    try {
      result = await fn({ query: (sql, params) => connQuery(conn, sql, params) });
      await call(conn, 'commit');
    } catch (err) {
      try {
        await call(conn, 'rollback');
      } catch (_) {
        // keep the original error
      }
      throw err;
    }
    return result;
  } finally {
    conn.release();
  }
}

function end() {
  return new Promise((resolve) => {
    if (!pool) return resolve();
    const p = pool;
    pool = null;
    p.end(() => resolve());
  });
}

module.exports = { query, withTransaction, getPool, setPool, end };
