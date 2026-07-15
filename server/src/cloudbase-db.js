import crypto from 'node:crypto';
import { config } from './config.js';

const SERVICE = 'tcb';
const ACTION = 'ExecutePGSql';
const VERSION = '2018-06-08';
const HOST = 'tcb.tencentcloudapi.com';
const ENDPOINT = `https://${HOST}`;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function utcDate(timestamp) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function signedHeaders(payload, timestamp, credentials) {
  const date = utcDate(timestamp);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${HOST}\nx-tc-action:${ACTION.toLowerCase()}\n`;
  const headers = 'content-type;host;x-tc-action';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${headers}\n${sha256(payload)}`;
  const scope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`;
  const dateKey = hmac(`TC3${credentials.secretKey}`, date);
  const serviceKey = hmac(dateKey, SERVICE);
  const signingKey = hmac(serviceKey, 'tc3_request');
  const signature = hmac(signingKey, stringToSign, 'hex');
  return `TC3-HMAC-SHA256 Credential=${credentials.secretId}/${scope}, SignedHeaders=${headers}, Signature=${signature}`;
}

function runtimeCredentials() {
  const secretId = process.env.TENCENTCLOUD_SECRETID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY;
  const token = process.env.TENCENTCLOUD_SESSIONTOKEN;
  if (!secretId || !secretKey) {
    throw new Error('CloudBase runtime credentials are unavailable');
  }
  return { secretId, secretKey, token };
}

function sqlLiteral(value) {
  if (value == null) return 'NULL';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (Buffer.isBuffer(value)) return `'\\x${value.toString('hex')}'`;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Database parameters must be finite numbers');
    return String(value);
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `'${text.replaceAll("'", "''")}'`;
}

export function bindSql(text, values = []) {
  return String(text).replace(/\$(\d+)\b/g, (placeholder, indexText) => {
    const index = Number(indexText) - 1;
    if (index < 0 || index >= values.length) throw new Error(`Missing database parameter ${placeholder}`);
    return sqlLiteral(values[index]);
  });
}

function resultSql(text, values) {
  const bound = bindSql(text, values).trim().replace(/;$/, '');
  const returnsRows = /^(SELECT|WITH)\b/i.test(bound) || /\bRETURNING\b/i.test(bound);
  if (!returnsRows) return { sql: bound, returnsRows: false };
  return {
    sql: `WITH __douhui_result AS (${bound}) SELECT COALESCE(jsonb_agg(to_jsonb(__douhui_result)), '[]'::jsonb)::text AS __douhui_rows FROM __douhui_result`,
    returnsRows: true,
  };
}

function databaseError(response, status) {
  const source = response?.Response?.Error || response?.error || response;
  const error = new Error(source?.Message || source?.message || `CloudBase database request failed (${status})`);
  const sqlState = error.message.match(/SQLSTATE\s+([0-9A-Z]{5})/i)?.[1];
  error.code = sqlState || source?.Code || source?.code || 'CLOUDBASE_DATABASE_ERROR';
  error.statusCode = status;
  return error;
}

async function execute(sql) {
  const credentials = runtimeCredentials();
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ EnvId: config.CLOUDBASE_ENV_ID, Sql: sql, Role: 'cloudbase_postgres' });
  const headers = {
    Authorization: signedHeaders(payload, timestamp, credentials),
    'Content-Type': 'application/json; charset=utf-8',
    Host: HOST,
    'X-TC-Action': ACTION,
    'X-TC-Version': VERSION,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Region': config.CLOUDBASE_REGION,
  };
  if (credentials.token) headers['X-TC-Token'] = credentials.token;
  const response = await fetch(ENDPOINT, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(12_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.Response?.Error) throw databaseError(body, response.status);
  return body.Response || body;
}

export async function cloudbaseQuery(text, values = []) {
  const prepared = resultSql(text, values);
  const result = await execute(prepared.sql);
  if (!prepared.returnsRows) {
    return { rows: [], rowCount: Number(result.AffectedRows || 0) };
  }
  const encodedRow = result.Rows?.[0];
  const encodedJson = encodedRow ? JSON.parse(encodedRow)?.[0] : '[]';
  const rows = encodedJson ? JSON.parse(encodedJson) : [];
  return { rows, rowCount: rows.length };
}
