# 豆绘账号 API

Node.js + Fastify + PostgreSQL 后端，为豆绘提供手机号、微信、QQ 登录，用户资料、图纸历史、库存和管理员审计功能。

## 安全设计

- 密码使用 Argon2id：64 MiB 内存、3 次迭代、并行度 1
- 验证码使用 HMAC-SHA256 保存，按手机号和用途绑定，5 分钟过期
- 验证码限制 60 秒重发、每手机号每小时 5 次、每 IP 每小时 20 次、最多 5 次校验
- 会话使用随机不透明令牌，数据库只保存 SHA-256 哈希
- Cookie 使用 HttpOnly；生产环境强制 Secure，跨站部署时使用 SameSite=None
- 密码登录按手机号和 IP 限流；管理员接口再次校验服务端角色
- 图纸采用软删除，管理员读取和删除行为写入审计日志
- 头像转换为 256×256 WebP 后上传腾讯 COS

## 本地启动

1. 复制 `.env.example` 为 `.env`，至少填写数据库、前端来源和 32 字符以上的 `OTP_PEPPER`。
2. 启动 PostgreSQL：`docker compose up -d`。
3. 安装依赖：`npm ci`。
4. 运行迁移：`npm run migrate`。
5. 启动 API：`npm run dev`。
6. 将前端 `api-config.js` 的 `DOUHUI_API_BASE` 设置为 `http://127.0.0.1:8787`。

运行测试：

```powershell
npm test
```

集成测试使用内存 PostgreSQL，执行正式迁移并覆盖注册、会话、普通用户隔离、管理员跨账号查看与删除、库存扣减幂等和色卡校验。

## 腾讯云上线

1. 在腾讯云容器服务、轻量应用服务器或云托管部署 `Dockerfile`，Node.js 运行时要求 20 或更高版本。
2. 创建 PostgreSQL，并通过私有网络提供 `DATABASE_URL`；生产环境建议开启 TLS，并设置 `DATABASE_SSL=true`。
3. 为 API 绑定 HTTPS 域名，将 `PUBLIC_API_URL` 设置为完整 API 地址。
4. 将 `FRONTEND_ORIGINS` 设置为允许访问账号 API 的前端来源，例如 `https://eric-zhouxi.github.io` 和将来的自定义域名。
5. 设置 `COOKIE_SECURE=true`。当前 GitHub Pages 与 API 跨站时设置 `COOKIE_SAME_SITE=none`；使用同站自定义子域名时优先 `lax`。
6. 在腾讯云短信控制台申请应用、签名和验证码模板，填写 `TENCENT_SMS_*`；模板参数依次为验证码、有效分钟数。
7. 在微信开放平台创建网站应用，将回调设置为 `PUBLIC_API_URL/auth/oauth/wechat/callback`，填写 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`。
8. 在 QQ 互联创建网站应用，将回调设置为 `PUBLIC_API_URL/auth/oauth/qq/callback`，填写 `QQ_APP_ID` 和 `QQ_APP_KEY`。
9. 创建私有 COS 存储桶，填写 `COS_BUCKET` 与 `COS_REGION`。可选用 `COS_PUBLIC_BASE_URL` 配置 CDN，否则头像使用短期签名 URL。
10. 在容器启动前运行 `npm run migrate`，再运行 `npm start`；健康检查地址为 `/health`。
11. 将前端 `api-config.js` 中的 `DOUHUI_API_BASE` 改为 HTTPS API 地址，重新发布 GitHub Pages。

## 创建管理员

管理员不硬编码在仓库。部署完成后，在腾讯云密钥管理或一次性容器环境中设置：

```powershell
$env:ADMIN_PHONE='<管理员手机号>'
$env:ADMIN_PASSWORD='<管理员初始密码>'
$env:ADMIN_NICKNAME='<管理员昵称>'
npm run admin:create
```

脚本会对密码做 Argon2id 哈希并将该账号的服务端角色设为 `admin`。执行后立即清理临时环境变量；聊天中出现过的密码应在正式上线前更换。

## 必填环境变量

完整清单见 `.env.example`。生产机密应保存在腾讯云密钥管理服务或部署平台的加密环境变量中，不要提交 `.env`、短信密钥、OAuth Secret、COS Secret 或管理员密码。
