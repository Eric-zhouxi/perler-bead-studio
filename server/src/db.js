import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;
const productionPool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : false,
  max: 15,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
let activePool = productionPool;

export const pool = {
  query(...args) {
    return activePool.query(...args);
  },
  connect(...args) {
    return activePool.connect(...args);
  },
  end(...args) {
    return activePool.end(...args);
  },
};

export function usePoolForTests(testPool) {
  if (config.NODE_ENV !== 'test') throw new Error('Database pool injection is only allowed in test mode');
  activePool = testPool;
}

export function query(text, values = []) {
  return activePool.query(text, values);
}

export async function transaction(work) {
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
