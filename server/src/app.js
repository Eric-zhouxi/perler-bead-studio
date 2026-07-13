import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { pool, query } from './db.js';
import { HttpError } from './http.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerInventoryRoutes } from './routes/inventory.js';
import { registerOAuthRoutes } from './routes/oauth.js';
import { registerPatternRoutes } from './routes/patterns.js';
import { registerUserRoutes } from './routes/users.js';
import { authenticate } from './session.js';
import * as smsService from './services/sms.js';

export async function buildApp(options = {}) {
  const app = Fastify({
    logger: options.logger ?? { level: config.isProduction ? 'info' : 'debug' },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });
  const allowedOrigins = new Set(config.frontendOrigins);

  await app.register(cookie);
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) callback(null, true);
      else callback(new HttpError(403, 'origin_not_allowed', '该网站来源不允许访问账户服务'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(multipart, { limits: { files: 1, fileSize: 3 * 1024 * 1024 } });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Cache-Control', request.url === '/health' ? 'no-cache' : 'no-store');
    return payload;
  });

  app.addHook('onRequest', async request => {
    const origin = request.headers.origin;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && origin && !allowedOrigins.has(origin)) {
      throw new HttpError(403, 'origin_not_allowed', '该网站来源不允许执行此操作');
    }
    request.user = await authenticate(request);
  });

  app.get('/health', async () => {
    await query('SELECT 1');
    return { ok: true, service: 'douhui-api' };
  });

  await registerAuthRoutes(app, { smsService: options.smsService || smsService });
  await registerOAuthRoutes(app);
  await registerUserRoutes(app);
  await registerPatternRoutes(app);
  await registerInventoryRoutes(app);
  await registerAdminRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (error.code === '23505') return reply.code(409).send({ error: { code: 'conflict', message: '数据已经存在' } });
    request.log.error({ err: error }, 'Unhandled request error');
    return reply.code(500).send({ error: { code: 'internal_error', message: '服务器暂时无法完成请求' } });
  });

  app.addHook('onClose', async () => {
    if (!options.keepPoolOpen) await pool.end();
  });
  return app;
}
