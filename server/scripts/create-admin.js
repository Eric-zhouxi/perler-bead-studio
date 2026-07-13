import { pool, query } from '../src/db.js';
import { hashPassword, isChineseMobile, normalizePhone, validatePasswordStrength } from '../src/security.js';

const phone = normalizePhone(process.env.ADMIN_PHONE);
const password = process.env.ADMIN_PASSWORD || '';
const nickname = (process.env.ADMIN_NICKNAME || '').trim();

if (!isChineseMobile(phone)) throw new Error('ADMIN_PHONE must be a valid Chinese mobile number');
if (!nickname) throw new Error('ADMIN_NICKNAME is required');
const passwordFailures = validatePasswordStrength(password);
if (passwordFailures.length) throw new Error(passwordFailures.join('; '));

try {
  const passwordHash = await hashPassword(password);
  const result = await query(
    `INSERT INTO users (phone, password_hash, nickname, role, phone_verified_at)
     VALUES ($1, $2, $3, 'admin', now())
     ON CONFLICT (phone) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           nickname = EXCLUDED.nickname,
           role = 'admin',
           phone_verified_at = COALESCE(users.phone_verified_at, now()),
           updated_at = now(),
           deleted_at = NULL
     RETURNING id, phone, nickname, role`,
    [phone, passwordHash, nickname],
  );
  process.stdout.write(`Administrator ready: ${result.rows[0].id}\n`);
} finally {
  await pool.end();
}
