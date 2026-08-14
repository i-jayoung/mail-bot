# 邮件助手 · Telegram + Resend + Cloudflare Workers

需要邮箱时把 `任意前缀@5o.vc` 填进去，邮件和验证码会推到 Telegram。也可以直接给机器人发文字代发邮件。

先打开 [`prototype/telegram-mail-bot.html`](prototype/telegram-mail-bot.html) 看交互（双击即可，假数据，不会真发信）。

## 你需要准备

1. **轮换密钥**。对话里出现过的 Resend API Key 和 Telegram Bot Token 不要再用于生产。
   - Resend：[作废并新建 API Key](https://resend.com/api-keys)
   - Telegram：对 [@BotFather](https://t.me/BotFather) 发 `/revoke` 换新 Token
2. 已验证的**发信 + 收信**域名（建议用子域，例如 `mail.example.com`，不要改正在用的 Gmail 根域 MX）
   - 发信：SPF / DKIM（Resend 控制台给出的记录）
   - 收信：MX 指向 Resend，且该域名上优先级最高（数字最小）
3. Cloudflare 账号（已登录 Wrangler）
4. 白名单用户的 Telegram **user id**（先给机器人发 `/start`，拒绝消息里会带上 id）

## 本地

```bash
npm install
copy .dev.vars.example .dev.vars
```

编辑 `.dev.vars`：填入轮换后的密钥、`FROM_EMAIL`、`ALLOWED_USER_IDS`。不要把 `.dev.vars` 提交到 git。

```bash
npx wrangler kv namespace create MAIL_KV
```

把返回的 id 写进 [`wrangler.jsonc`](wrangler.jsonc) 的 `kv_namespaces[0].id`。

```bash
npm run dev
```

本地收不到 Telegram webhook。真机联调必须先 deploy。

## 部署

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put RESEND_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

`FROM_EMAIL`、`ALLOWED_USER_IDS`、`NOTIFY_ADDRESSES` 是普通变量，改 [`wrangler.jsonc`](wrangler.jsonc) 里的 `vars` 后重新 deploy。

```jsonc
"vars": {
  "FROM_EMAIL": "Mail Bot <bot@5o.vc>",
  "ALLOWED_USER_IDS": "123456789,987654321",
  "NOTIFY_ADDRESSES": ""
}
```

- `FROM_EMAIL`：代发时的默认发件地址（对话里可改）
- `NOTIFY_ADDRESSES` 留空 = 该域名任意前缀都推送（catch-all）。只有想收窄时才填。

```bash
npx wrangler deploy
```

记下 Worker 网址：`https://mail.5o.vc`。

### 接上 Telegram

把 `SECRET` 换成你放进 `TELEGRAM_WEBHOOK_SECRET` 的同一串（随机即可）：

```text
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://mail.5o.vc/telegram&secret_token=SECRET
```

建议 BotFather `/setjoingroups` 关掉，只用于私聊。

### 接上 Resend

1. [Webhooks](https://resend.com/webhooks) → Add Webhook
2. URL：`https://mail.5o.vc/webhooks/resend`
3. 事件：`email.received`、`email.bounced`
4. 把 signing secret 放进 `RESEND_WEBHOOK_SECRET`

## 怎么用

- 需要邮箱时填 `随便前缀@你的域名`，邮件会推送到 Telegram，可一键复制验证码 / 正文
- 代发邮件：发正文 → 设发件（默认 `bot@5o.vc`，回复 `1` 即可）→ 填收件地址 → 自动发出
- `/cancel` 或发「取消」放弃当前操作

## 安全

密钥只放 Workers Secrets / `.dev.vars`，不要写进代码或 README。
