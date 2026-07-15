import pg from 'pg';
import { config } from './config.js';
import { cloudbaseQuery } from './cloudbase-db.js';

const { Pool } = pg;
const productionPool = config.DATABASE_DRIVER === 'postgres'
  ? new Pool({
      connectionString: config.DATABASE_URL,
      ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : false,
      max: 15,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  : null;
let activePool = productionPool;

function isCloudBase() {
  return config.DATABASE_DRIVER === 'cloudbase' && activePool === productionPool;
}

export const pool = {
  query(...args) {
    return isCloudBase() ? cloudbaseQuery(...args) : activePool.query(...args);
  },
  connect(...args) {
    if (isCloudBase()) throw new Error('Direct database connections are unavailable in CloudBase HTTP mode');
    return activePool.connect(...args);
  },
  end(...args) {
    if (isCloudBase()) return Promise.resolve();
    return activePool.end(...args);
  },
};

export function usePoolForTests(testPool) {
  if (config.NODE_ENV !== 'test') throw new Error('Database pool injection is only allowed in test mode');
  activePool = testPool;
}

export function query(text, values = []) {
  return isCloudBase() ? cloudbaseQuery(text, values) : activePool.query(text, values);
}

export async function transaction(work) {
  if (isCloudBase()) {
    // ExecutePGSql is a stateless HTTPS API. Route-level operations remain
    // serialized here; database uniqueness constraints provide the final guard.
    return work({ query: cloudbaseQuery });
  }
  const client = await activePool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
