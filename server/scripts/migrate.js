import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = path.join(root, 'migrations');

try {
  const files = (await fs.readdir(migrationDir)).filter(file => file.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationDir, file), 'utf8');
    await pool.query(sql);
    process.stdout.write(`Applied ${file}\n`);
  }
} finally {
  await pool.end();
}
