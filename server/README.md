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

## 腾讯 CloudBase 上线

当前生产环境使用普通 Event 云函数 `douhui-api-gateway`，由 HTTP 访问服务把 `/api` 转发到函数。免费套餐不提供 VPC，因此云函数不直连 PostgreSQL 私网地址，而是使用运行时临时身份签名调用 CloudBase `ExecutePGSql` HTTPS 接口。

生产环境需要设置：

- `DATABASE_DRIVER=cloudbase`
- `CLOUDBASE_ENV_ID=douhui-prod-d1g1urejqdaeee4d4`
- `CLOUDBASE_REGION=ap-shanghai`
- `PUBLIC_API_URL=https://douhui-prod-d1g1urejqdaeee4d4-1453834128.ap-shanghai.app.tcloudbase.com/api`
- `FRONTEND_ORIGINS=https://eric-zhouxi.github.io,https://douhui-prod-d1g1urejqdaeee4d4-1453834128.tcloudbaseapp.com`
- `COOKIE_SECURE=true` 与 `COOKIE_SAME_SITE=none`

数据库迁移通过已登录的 CloudBase CLI 执行。`ExecutePGSql` 每次只执行一条语句，因此迁移文件需要按分号拆分后逐条运行；不要把数据库密码或 API Key 写进仓库。构建和部署命令：

```powershell
npm run build:cloudbase
npx --yes --package=@cloudbase/cli@latest tcb fn deploy douhui-api-gateway -e douhui-prod-d1g1urejqdaeee4d4 --yes
```

生产健康检查地址为 `PUBLIC_API_URL/health`。前端 `api-config.js` 已指向该 HTTPS API。

手机号注册仍需要短信通道。可在 CloudBase 身份认证中启用短信验证码，或在腾讯云短信控制台申请应用、签名和模板后填写 `TENCENT_SMS_*`；启用前先确认免费额度和超额费用。微信、QQ、COS 头像同样只在对应环境变量完整配置后启用。

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

完整清单见 `.env.example`。生产机密应保存在腾讯云密钥管理服务或部署平台的加密环境变量中，不要提交 `.env`、短信密钥、OAuth Secret、COS Secret 或管理员密码。CloudBase 云函数运行时自动注入的 `TENCENTCLOUD_*` 临时凭据也不得记录到日志或返回给客户端。
