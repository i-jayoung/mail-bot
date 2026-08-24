import { Bot, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { Env, ReceivedEmail, SendSession, Session } from "../env";
import { buildMailPushMessage } from "../lib/format";
import { md2Bold, md2Code, md2Esc, stripMd2 } from "../lib/md2";
import {
  addSubscriber,
  clearSession,
  ensureAllowed,
  getAllowlist,
  getSession,
  getSubscribers,
  mapSent,
  putMailView,
  putSession,
} from "../lib/kv";
import { mailViewFromEmail, mailViewUrl } from "../lib/mailView";
import * as resend from "../lib/resend";
import { isEmail, mailDomain, parseFromAddress, parseSendFrom } from "../lib/text";
import { removeReplyKb, viewMailKb } from "./keyboards";

export type BotCtx = Context & { env: Env };

const PARSE_MODE = "MarkdownV2" as const;
const NO_LINK_PREVIEW = { link_preview_options: { is_disabled: true } as const };

const BOT_COMMANDS = [
  { command: "start", description: "开始使用" },
  { command: "cancel", description: "取消" },
] as const;

let commandsSynced = false;

function denyText(userId: number): string {
  return `这个机器人只对白名单开放。\n\n你的 user id：${userId}\n把这串数字发给管理员即可。`;
}

function isSend(s: Session | null): s is SendSession {
  return s?.type === "send";
}

function defaultFrom(env: Env): string {
  return env.FROM_EMAIL;
}

function defaultFromAddr(env: Env): string {
  return parseFromAddress(defaultFrom(env));
}

function normalizeCmd(text: string): string {
  return text.replace(/@\w+$/, "").trim();
}

function isDefaultFromInput(text: string): boolean {
  const t = text.trim();
  return !t || t === "1" || /^(默认|default)$/i.test(t);
}

function isLegacyMenu(text: string): boolean {
  const t = text.replace(/^[^\u4e00-\u9fff]+/u, "").trim();
  return ["收件箱", "已发送", "发信", "搜索"].includes(t);
}

async function dropReplyKb(ctx: BotCtx) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  try {
    const msg = await ctx.api.sendMessage(chatId, "\u3164", {
      reply_markup: removeReplyKb(),
      disable_notification: true,
    });
    try {
      await ctx.api.deleteMessage(chatId, msg.message_id);
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}

async function say(ctx: BotCtx, text: string) {
  try {
    await ctx.reply(text, { parse_mode: PARSE_MODE, reply_markup: removeReplyKb(), ...NO_LINK_PREVIEW });
  } catch {
    await ctx.reply(stripMd2(text), { reply_markup: removeReplyKb(), ...NO_LINK_PREVIEW });
  }
}

async function replyPlain(ctx: BotCtx, text: string) {
  await ctx.reply(text, { reply_markup: removeReplyKb(), ...NO_LINK_PREVIEW });
}

export async function syncBotCommands(env: Env): Promise<void> {
  if (commandsSynced) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: BOT_COMMANDS }),
    });
    if (res.ok) commandsSynced = true;
  } catch {
    /* ignore */
  }
}

async function showStart(ctx: BotCtx) {
  const domain = mailDomain(ctx.env.FROM_EMAIL) || "your-domain.com";
  const def = defaultFromAddr(ctx.env);
  await syncBotCommands(ctx.env);
  await say(
    ctx,
    [
      md2Bold("📬 邮件助手"),
      "",
      md2Bold("📥 收信"),
      `需要邮箱时填 ${md2Code(`任意前缀@${domain}`)}`,
      "邮件会推送到这里",
      "",
      md2Bold("📤 发信"),
      "① 发正文，例如 " + md2Code("abc"),
      `② 设发件：回复 ${md2Bold("1")} 用默认 ${md2Code(def)}，或发自定义地址`,
      "③ 填收件邮箱 → 自动发出",
      "",
      "取消发信：" + md2Code("/cancel"),
    ].join("\n"),
  );
}

function promptFrom(env: Env): string {
  const def = defaultFromAddr(env);
  return [
    md2Bold("📤 请设置发件邮箱"),
    `⚙️ 默认 ${md2Code(def)}`,
    "✏️ 也可直接发自定义发件地址",
    "👆 使用默认请回复 " + md2Bold("1"),
  ].join("\n");
}

function promptTo(): string {
  return md2Bold("📥 请填写收件邮箱地址");
}

async function startSend(ctx: BotCtx, body: string) {
  const s: SendSession = {
    type: "send",
    step: "from",
    body,
    idem: crypto.randomUUID(),
    expires: 0,
  };
  await putSession(ctx.env, ctx.from!.id, s);
  await say(ctx, promptFrom(ctx.env));
}

async function applyFrom(ctx: BotCtx, s: SendSession, text: string) {
  if (isDefaultFromInput(text)) {
    s.from = defaultFrom(ctx.env);
  } else {
    const parsed = parseSendFrom(defaultFrom(ctx.env), text);
    const domain = mailDomain(defaultFrom(ctx.env));
    if (!parsed.ok) {
      await say(
        ctx,
        parsed.reason === "domain"
          ? `⚠️ 只能用 @${domain} 这个域名发信。\n👆 使用默认请回复 ${md2Bold("1")}`
          : `⚠️ 发前缀或完整邮箱，例如 ${md2Code("support")}\n👆 使用默认请回复 ${md2Bold("1")}`,
      );
      return;
    }
    s.from = parsed.value;
  }
  s.step = "to";
  s.idem = crypto.randomUUID();
  await putSession(ctx.env, ctx.from!.id, s);
  await say(ctx, promptTo());
}

async function applyToAndSend(ctx: BotCtx, s: SendSession, text: string) {
  const addr = text.trim();
  if (!isEmail(addr)) {
    await say(ctx, `⚠️ 这不像邮箱地址\n例如 ${md2Code("user@example.com")}`);
    return;
  }
  s.to = addr;
  await putSession(ctx.env, ctx.from!.id, s);
  await doSend(ctx, s);
}

async function doSend(ctx: BotCtx, s: SendSession) {
  const userId = ctx.from!.id;
  const from = s.from || defaultFrom(ctx.env);
  const to = s.to;
  if (!to) {
    await say(ctx, md2Bold("📥 请填写收件邮箱地址"));
    return;
  }
  const { data, error } = await resend.sendEmail(
    ctx.env.RESEND_API_KEY,
    { from, to: [to], subject: "(无主题)", text: s.body },
    s.idem,
  );
  if (error || !data?.id) {
    await replyPlain(ctx, error?.includes("429") ? "发信太快，请稍后再试。" : `没发出去。${error ?? ""}`.trim());
    return;
  }
  await mapSent(ctx.env, data.id, userId);
  await clearSession(ctx.env, userId);
  await say(ctx, `✅ 已从 ${md2Code(parseFromAddress(from))} 发送到 ${md2Code(to)}`);
}

async function cancelWizard(ctx: BotCtx) {
  await clearSession(ctx.env, ctx.from!.id);
  await replyPlain(ctx, "🚫 已取消。");
}

export function createBot(env: Env, botInfo?: UserFromGetMe): Bot<BotCtx> {
  void syncBotCommands(env);
  const bot = new Bot<BotCtx>(env.TELEGRAM_BOT_TOKEN, botInfo ? { botInfo } : {});
  bot.use(async (ctx, next) => {
    ctx.env = env;
    await next();
  });

  bot.on("message", async (ctx) => {
    try {
      if (ctx.chat?.type !== "private") return;
      const userId = ctx.from?.id;
      if (!userId) return;
      const text = ctx.message.text?.trim() ?? "";

      if (text === "/whoami" || text.startsWith("/whoami@")) {
        await replyPlain(ctx, `你的 user id：${userId}`);
        return;
      }

      if (!(await ensureAllowed(env, userId))) {
        await replyPlain(ctx, denyText(userId));
        return;
      }
      await addSubscriber(env, userId, ctx.chat.id);
      await dropReplyKb(ctx);

      const session = await getSession(env, userId);
      const cmd = normalizeCmd(text);

      if (cmd === "/cancel" || text === "取消") {
        await cancelWizard(ctx);
        return;
      }
      if (cmd === "/start") {
        await clearSession(env, userId);
        await showStart(ctx);
        return;
      }

      if (isLegacyMenu(text)) {
        await replyPlain(ctx, "直接发文字给我即可。");
        return;
      }

      if (isSend(session)) {
        if (session.step === "from") {
          await applyFrom(ctx, session, text);
          return;
        }
        if (session.step === "to") {
          if (!text) {
            await say(ctx, md2Bold("📥 请填写收件邮箱地址"));
            return;
          }
          await applyToAndSend(ctx, session, text);
          return;
        }
      }

      if (!text) return;

      if (isSend(session)) {
        await replyPlain(ctx, "请先完成当前邮件，或发 /cancel 取消。");
        return;
      }

      await startSend(ctx, text);
    } catch (e) {
      console.error("message handler", e);
      try {
        await replyPlain(ctx, "出错了，请稍后再试。");
      } catch {
        /* ignore */
      }
    }
  });

  bot.catch((err) => {
    console.error("bot error", err);
  });

  return bot;
}

async function sendTelegramMd2(
  env: Env,
  chatId: number,
  text: string,
  extra?: { reply_markup?: { inline_keyboard: unknown[] } },
): Promise<boolean> {
  const base = { chat_id: chatId, link_preview_options: { is_disabled: true }, ...extra };
  let res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...base, text, parse_mode: "MarkdownV2" }),
  });
  if (res.ok) return true;
  res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...base, text: stripMd2(text) }),
  });
  return res.ok;
}

export async function notifyInbound(env: Env, email: ReceivedEmail) {
  if (!email.id) throw new Error("missing email id");

  await putMailView(env, email.id, mailViewFromEmail(email));
  const message = buildMailPushMessage(email, true);
  const kb = viewMailKb(mailViewUrl(env, email.id));

  const subs = await getSubscribers(env);
  const allow = await getAllowlist(env);
  const targets = subs.filter((s) => !allow.length || allow.includes(s.id));
  if (!targets.length) return;

  let sent = 0;
  for (const s of targets) {
    try {
      const ok = await sendTelegramMd2(env, s.chat, message, {
        reply_markup: { inline_keyboard: kb.inline_keyboard },
      });
      if (ok) sent++;
    } catch (e) {
      console.error("notify fail", s.id, e);
    }
  }
  if (sent === 0) throw new Error("notify all failed");
}

export async function notifyBounce(env: Env, userId: number, detail: string) {
  const subs = await getSubscribers(env);
  const s = subs.find((x) => x.id === userId);
  if (!s) return;
  const mdText = `${md2Bold("投递失败")}\n${md2Esc(detail)}`;
  const plainText = `投递失败\n${detail}`;
  let res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: s.chat,
      text: mdText,
      parse_mode: "MarkdownV2",
      link_preview_options: { is_disabled: true },
    }),
  });
  if (!res.ok) {
    res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: s.chat,
        text: plainText,
        link_preview_options: { is_disabled: true },
      }),
    });
  }
  if (!res.ok) throw new Error(`bounce notify ${res.status}`);
}
