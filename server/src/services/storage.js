import crypto from 'node:crypto';
import COS from 'cos-nodejs-sdk-v5';
import sharp from 'sharp';
import { config } from '../config.js';
import { HttpError } from '../http.js';

let client;

function getClient() {
  if (!config.cosConfigured) throw new HttpError(503, 'storage_not_configured', '头像存储服务尚未配置');
  client ||= new COS({ SecretId: config.TENCENT_SECRET_ID, SecretKey: config.TENCENT_SECRET_KEY });
  return client;
}
function putObject(options) {
  return new Promise((resolve, reject) => getClient().putObject(options, (error, data) => error ? reject(error) : resolve(data)));
}

function deleteObject(options) {
  return new Promise((resolve, reject) => getClient().deleteObject(options, error => error ? reject(error) : resolve()));
}

export async function uploadAvatar(userId, input) {
  let output;
  try {
    output = await sharp(input, { failOn: 'error' }).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 84 }).toBuffer();
  } catch {
    throw new HttpError(400, 'invalid_avatar', '头像图片无法读取');
  }
  const key = `avatars/${userId}/${crypto.randomUUID()}.webp`;
  await putObject({ Bucket: config.COS_BUCKET, Region: config.COS_REGION, Key: key, Body: output, ContentType: 'image/webp' });
  return key;
}

export async function deleteStoredObject(key) {
  if (!key || !config.cosConfigured) return;
  await deleteObject({ Bucket: config.COS_BUCKET, Region: config.COS_REGION, Key: key });
}

export function signedObjectUrl(key, expires = 900) {
  if (!key) return null;
  if (config.COS_PUBLIC_BASE_URL) return `${config.COS_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
  return getClient().getObjectUrl({ Bucket: config.COS_BUCKET, Region: config.COS_REGION, Key: key, Sign: true, Expires: expires });
}
