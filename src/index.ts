import { Hono } from "hono";
import { webhookCallback } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { createBot, syncBotCommands } from "./bot/createBot";
import type { Env } from "./env";
import { handleResendWebhook } from "./resend/webhook";

let cachedBotInfo: UserFromGetMe | undefined;

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("mail-bot ok"));

async function registerTelegramWebhook(env: Env, dropPending = false): Promise<unknown> {
  const origin = (env.PUBLIC_URL || "https://mail.5o.vc").replace(/\/$/, "");
  const hook = `${origin}/telegram`;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: hook,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: dropPending,
    }),
  });
  return res.json();
}

app.get("/setup", async (c) => {
  const key = c.req.query("key");
  if (!key || key !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.text("unauthorized", 401);
  }
  const telegram = (await registerTelegramWebhook(c.env, true)) as { ok?: boolean };
  await syncBotCommands(c.env);
  if (telegram?.ok) {
    const origin = (c.env.PUBLIC_URL || "https://mail.5o.vc").replace(/\/$/, "");
    await c.env.MAIL_KV.put("tg_webhook_ok", `${origin}/telegram`);
  }
  return c.json({ telegram });
});

app.post("/webhooks/resend", async (c) => {
  return handleResendWebhook(c.env, c.req.raw);
});

app.post("/telegram", async (c) => {
  const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (!c.env.TELEGRAM_WEBHOOK_SECRET || secret !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.text("unauthorized", 401);
  }
  const bot = createBot(c.env, cachedBotInfo);
  if (!cachedBotInfo) {
    await bot.init();
    cachedBotInfo = bot.botInfo;
  }
  const handle = webhookCallback(bot, "cloudflare-mod");
  try {
    return await handle(c.req.raw);
  } catch (err) {
    console.error("telegram webhook", err);
    return c.text("ok");
  }
});

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const expected = `${(env.PUBLIC_URL || "https://mail.5o.vc").replace(/\/$/, "")}/telegram`;
        if ((await env.MAIL_KV.get("tg_webhook_ok")) === expected) return;
        const telegram = (await registerTelegramWebhook(env)) as { ok?: boolean };
        console.log("setWebhook", telegram);
        if (telegram?.ok) await env.MAIL_KV.put("tg_webhook_ok", expected);
      })(),
    );
  },
};
