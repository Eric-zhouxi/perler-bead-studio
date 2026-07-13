import crypto from 'node:crypto';
import argon2 from 'argon2';
import { config } from './config.js';

const ARGON_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
});

export function normalizePhone(phone) {
  return String(phone || '').replace(/[\s-]/g, '');
}
export function isChineseMobile(phone) {
  return /^1[3-9]\d{9}$/.test(normalizePhone(phone));
}

export function validatePasswordStrength(password) {
  const value = String(password || '');
  const failures = [];
  if (value.length < 8) failures.push('密码至少需要 8 个字符');
  if (value.length > 128) failures.push('密码不能超过 128 个字符');
  if (!/[a-z]/.test(value)) failures.push('密码需要包含小写字母');
  if (!/[A-Z]/.test(value)) failures.push('密码需要包含大写字母');
  if (!/\d/.test(value)) failures.push('密码需要包含数字');
  if (!/[^A-Za-z0-9]/.test(value)) failures.push('密码需要包含特殊字符');
  return failures;
}

export function hashPassword(password) {
  return argon2.hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(hash, password) {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, password, ARGON_OPTIONS);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function hashOtp(phone, purpose, code) {
  return crypto.createHmac('sha256', config.OTP_PEPPER).update(`${normalizePhone(phone)}:${purpose}:${code}`).digest('hex');
}

export function safeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function patternFingerprint(pattern) {
  const data = JSON.stringify({
    width: pattern.width,
    height: pattern.height,
    paletteSize: pattern.paletteSize,
    beads: pattern.beads,
  });
  return sha256(data);
}
