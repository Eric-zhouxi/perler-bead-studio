import 'dotenv/config';
import { z } from 'zod';

const booleanValue = z.string().optional().transform(value => value === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_DRIVER: z.enum(['postgres', 'cloudbase']).default('postgres'),
  DATABASE_URL: z.string().optional().default(''),
  DATABASE_SSL: booleanValue,
  CLOUDBASE_ENV_ID: z.string().optional().default(''),
  CLOUDBASE_REGION: z.string().default('ap-shanghai'),
  FRONTEND_ORIGINS: z.string().min(1),
  PUBLIC_API_URL: z.string().url(),
  SESSION_COOKIE_NAME: z.string().default('douhui_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  COOKIE_SECURE: booleanValue,
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  OTP_PEPPER: z.string().min(32),
  TENCENT_SECRET_ID: z.string().optional().default(''),
  TENCENT_SECRET_KEY: z.string().optional().default(''),
  TENCENT_SMS_REGION: z.string().default('ap-guangzhou'),
  TENCENT_SMS_APP_ID: z.string().optional().default(''),
  TENCENT_SMS_SIGN_NAME: z.string().optional().default(''),
  TENCENT_SMS_TEMPLATE_ID: z.string().optional().default(''),
  WECHAT_APP_ID: z.string().optional().default(''),
  WECHAT_APP_SECRET: z.string().optional().default(''),
  WECHAT_REDIRECT_URI: z.string().url(),
  QQ_APP_ID: z.string().optional().default(''),
  QQ_APP_KEY: z.string().optional().default(''),
  QQ_REDIRECT_URI: z.string().url(),
  COS_BUCKET: z.string().optional().default(''),
  COS_REGION: z.string().default('ap-guangzhou'),
  COS_PUBLIC_BASE_URL: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

const env = parsed.data;
if (env.DATABASE_DRIVER === 'postgres' && !env.DATABASE_URL) {
  throw new Error('Invalid environment configuration:\nDATABASE_URL is required when DATABASE_DRIVER=postgres');
}
if (env.DATABASE_DRIVER === 'cloudbase' && !env.CLOUDBASE_ENV_ID) {
  throw new Error('Invalid environment configuration:\nCLOUDBASE_ENV_ID is required when DATABASE_DRIVER=cloudbase');
}
if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
  throw new Error('Invalid environment configuration:\nCOOKIE_SECURE must be true in production');
}
if (env.COOKIE_SAME_SITE === 'none' && !env.COOKIE_SECURE) {
  throw new Error('Invalid environment configuration:\nCOOKIE_SAME_SITE=none requires COOKIE_SECURE=true');
}
export const config = Object.freeze({
  ...env,
  isProduction: env.NODE_ENV === 'production',
  frontendOrigins: env.FRONTEND_ORIGINS.split(',').map(value => value.trim()).filter(Boolean),
  sessionTtlMs: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  smsConfigured: Boolean(env.TENCENT_SECRET_ID && env.TENCENT_SECRET_KEY && env.TENCENT_SMS_APP_ID && env.TENCENT_SMS_SIGN_NAME && env.TENCENT_SMS_TEMPLATE_ID),
  cosConfigured: Boolean(env.TENCENT_SECRET_ID && env.TENCENT_SECRET_KEY && env.COS_BUCKET),
  oauthConfigured: {
    wechat: Boolean(env.WECHAT_APP_ID && env.WECHAT_APP_SECRET),
    qq: Boolean(env.QQ_APP_ID && env.QQ_APP_KEY),
  },
});
