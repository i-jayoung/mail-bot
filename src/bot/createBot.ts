import { Bot, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { Env, ReceivedEmail, SendSession, Session } from "../env";
import { buildMailPushMessage, fieldBlock, fieldLine, fieldLinkLine, gapLines } from "../lib/format";
import { md2Bold, md2Code, md2Esc, stripMd2 } from "../lib/md2";
import {
  addSubscriber,
  clearSession,
  ensureAllowed,
  getAllowlist,
  getMailView,
  getSession,
  getSubscribers,
  mapSent,
  putMailView,
  putSession,
} from "../lib/kv";
import { mailViewFromEmail, mailViewUrl, replyRouteFromMail } from "../lib/mailView";
import * as resend from "../lib/resend";
import { isEmail, mailDomain, parseFromAddress, parseSendFrom } from "../lib/text";
import { inboundMailKb, removeReplyKb, wizardCancelKb, wizardConfirmKb } from "./keyboards";

export type BotCtx = Context & { env: Env };

const PARSE_MODE = "MarkdownV2" as const;
const NO_LINK_PREVIEW = { link_preview_options: { is_disabled: true } as const };
/** 避免「回复某条长消息」时客户端在气泡里留出大块空白引用区 */
const REPLY_OPTS = {
  ...NO_LINK_PREVIEW,
  reply_parameters: { allow_sending_without_reply: true as const },
};

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
    await ctx.reply(text, { parse_mode: PARSE_MODE, reply_markup: removeReplyKb(), ...REPLY_OPTS });
  } catch {
    await ctx.reply(stripMd2(text), { reply_markup: removeReplyKb(), ...REPLY_OPTS });
  }
}

async function sayInline(
  ctx: BotCtx,
  text: string,
  markup: ReturnType<typeof wizardCancelKb> | ReturnType<typeof wizardConfirmKb>,
): Promise<number | undefined> {
  const reply_markup = markup;
  try {
    const m = await ctx.reply(text, { parse_mode: PARSE_MODE, reply_markup, ...REPLY_OPTS });
    return m.message_id;
  } catch {
    const m = await ctx.reply(stripMd2(text), { reply_markup, ...REPLY_OPTS });
    return m.message_id;
  }
}

async function deleteMessageQuiet(ctx: BotCtx, chatId: number, messageId: number) {
  try {
    await ctx.api.deleteMessage(chatId, messageId);
  } catch {
    /* ignore */
  }
}

/** 删除当前待确认气泡（点按钮时用 callback 消息，/cancel 用 session 记录） */
async function dismissConfirmPrompt(ctx: BotCtx, session?: SendSession | null) {
  const cbMsg = ctx.callbackQuery?.message;
  if (cbMsg && "message_id" in cbMsg) {
    await deleteMessageQuiet(ctx, cbMsg.chat.id, cbMsg.message_id);
    return;
  }
  if (session?.confirmChat != null && session.confirmMsg != null) {
    await deleteMessageQuiet(ctx, session.confirmChat, session.confirmMsg);
  }
}

async function postConfirm(ctx: BotCtx, s: SendSession, userId: number, text: string) {
  await dismissConfirmPrompt(ctx, s);
  const chatId = ctx.chat?.id;
  const msgId = await sayInline(ctx, text, wizardConfirmKb());
  if (chatId != null && msgId != null) {
    s.confirmChat = chatId;
    s.confirmMsg = msgId;
    await putSession(ctx.env, userId, s);
  }
}

async function replyPlain(ctx: BotCtx, text: string) {
  await ctx.reply(text.trim(), REPLY_OPTS);
}

async function answer(ctx: BotCtx, opts?: { text?: string; show_alert?: boolean }) {
  try {
    await ctx.answerCallbackQuery(opts);
  } catch {
    /* ignore */
  }
}

function promptReplyBody(from: string, to: string): string {
  return gapLines(
    md2Esc("回复邮件"),
    fieldBlock(fieldLinkLine("👤", "发件", parseFromAddress(from)), fieldLine("📥", "收件", to)),
    md2Esc("请直接发送回复正文"),
  );
}

async function startReply(ctx: BotCtx, emailId: string) {
  const mail = await getMailView(ctx.env, emailId);
  if (!mail) {
    await answer(ctx, { text: "邮件已过期，无法回复", show_alert: true });
    return;
  }
  const route = replyRouteFromMail(ctx.env, mail);
  if (!route) {
    await answer(ctx, { text: "无法使用该收件地址回复", show_alert: true });
    return;
  }
  const s: SendSession = {
    type: "send",
    step: "body",
    body: "",
    from: route.from,
    to: route.to,
    subject: route.subject,
    idem: crypto.randomUUID(),
    expires: 0,
  };
  await putSession(ctx.env, ctx.from!.id, s);
  await answer(ctx);
  await sayInline(ctx, promptReplyBody(route.from, route.to), wizardCancelKb());
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
      `② 设发件：回复 ${md2Code("1")} 用默认 ${md2Code(def)}，或发自定义地址`,
      "③ 填收件邮箱 → 确认后发出",
    ].join("\n"),
  );
}

function bodyPreview(body: string, max = 160): string {
  const t = body.replace(/\s+/g, " ").trim();
  if (!t) return "（空）";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function promptFrom(env: Env): string {
  return gapLines(
    `📤 ${md2Esc("请设置发件邮箱")}`,
    fieldLine("⚙️", "默认", defaultFromAddr(env)),
    md2Esc("回复 1 使用默认，或输入发件地址"),
  );
}

function promptTo(): string {
  return `📥 ${md2Esc("请填写收件邮箱")}`;
}

function promptMailConfirm(s: SendSession, env: Env, title: string): string {
  const fromRaw = s.from || defaultFrom(env);
  const subj = s.subject?.trim();
  return gapLines(
    md2Esc(title),
    fieldBlock(
      fieldLinkLine("👤", "发件", parseFromAddress(fromRaw)),
      fieldLine("📥", "收件", s.to || "?"),
      subj && subj !== "(无主题)" ? fieldLine("📋", "主题", bodyPreview(subj, 120)) : null,
      fieldLine("📝", "正文", bodyPreview(s.body)),
    ),
  );
}

async function remindConfirm(ctx: BotCtx, s: SendSession) {
  const title = s.confirmLabel ?? "确认发送";
  await postConfirm(ctx, s, ctx.from!.id, promptMailConfirm(s, ctx.env, title));
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
  await sayInline(ctx, promptFrom(ctx.env), wizardCancelKb());
}

async function applyFrom(ctx: BotCtx, s: SendSession, text: string) {
  if (isDefaultFromInput(text)) {
    s.from = defaultFrom(ctx.env);
  } else {
    const parsed = parseSendFrom(defaultFrom(ctx.env), text);
    const domain = mailDomain(defaultFrom(ctx.env));
    if (!parsed.ok) {
      await sayInline(
        ctx,
        gapLines(
          md2Esc("⚠️ 发件地址无效"),
          parsed.reason === "domain"
            ? md2Esc(`只能使用 @${domain} 域名`)
            : md2Esc("可发前缀或完整邮箱，例如 support"),
          md2Esc("回复 1 使用默认发件地址"),
        ),
        wizardCancelKb(),
      );
      return;
    }
    s.from = parsed.value;
  }
  s.step = "to";
  s.idem = crypto.randomUUID();
  await putSession(ctx.env, ctx.from!.id, s);
  await sayInline(ctx, promptTo(), wizardCancelKb());
}

async function applyToAndConfirm(ctx: BotCtx, s: SendSession, text: string) {
  const addr = text.trim();
  if (!isEmail(addr)) {
    await sayInline(
      ctx,
      gapLines(`⚠️ ${md2Esc("这不像邮箱地址")}`, fieldLine("📌", "示例", "user@example.com")),
      wizardCancelKb(),
    );
    return;
  }
  s.to = addr;
  s.step = "confirm";
  s.confirmLabel = "确认发送";
  s.idem = crypto.randomUUID();
  await putSession(ctx.env, ctx.from!.id, s);
  await postConfirm(ctx, s, ctx.from!.id, promptMailConfirm(s, ctx.env, "确认发送"));
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
    { from, to: [to], subject: s.subject?.trim() || "(无主题)", text: s.body },
    s.idem,
  );
  if (error || !data?.id) {
    await replyPlain(ctx, error?.includes("429") ? "发信太快，请稍后再试。" : `没发出去。${error ?? ""}`.trim());
    return;
  }
  await mapSent(ctx.env, data.id, userId);
  await dismissConfirmPrompt(ctx, s);
  await clearSession(ctx.env, userId);
  await say(
    ctx,
    gapLines(
      md2Esc("✅ 已发送"),
      fieldBlock(fieldLinkLine("👤", "发件", parseFromAddress(from)), fieldLine("📥", "收件", to)),
    ),
  );
}

async function cancelWizard(ctx: BotCtx) {
  const userId = ctx.from!.id;
  const session = await getSession(ctx.env, userId);
  await dismissConfirmPrompt(ctx, isSend(session) ? session : null);
  await clearSession(ctx.env, userId);
  await replyPlain(ctx, "🚫 已取消。");
}

export function createBot(env: Env, botInfo?: UserFromGetMe): Bot<BotCtx> {
  void syncBotCommands(env);
  const bot = new Bot<BotCtx>(env.TELEGRAM_BOT_TOKEN, botInfo ? { botInfo } : {});
  bot.use(async (ctx, next) => {
    ctx.env = env;
    await next();
  });

  bot.on("callback_query:data", async (ctx) => {
    try {
      const userId = ctx.from?.id;
      if (!userId || ctx.chat?.type !== "private") {
        await answer(ctx);
        return;
      }
      if (!(await ensureAllowed(env, userId))) {
        await answer(ctx, { text: "无权限", show_alert: true });
        return;
      }
      const data = ctx.callbackQuery.data;
      if (data.startsWith("reply:")) {
        await startReply(ctx, data.slice(6));
        return;
      }
      if (data === "cancel") {
        await answer(ctx);
        await cancelWizard(ctx);
        return;
      }
      if (data === "send:confirm") {
        const session = await getSession(env, userId);
        if (!isSend(session) || session.step !== "confirm") {
          await answer(ctx, { text: "会话已过期，请重新发信", show_alert: true });
          return;
        }
        session.idem = crypto.randomUUID();
        await putSession(env, userId, session);
        await answer(ctx);
        await doSend(ctx, session);
        return;
      }
      await answer(ctx);
    } catch (e) {
      console.error("callback_query", e);
      await answer(ctx, { text: "出错了，请稍后再试", show_alert: true });
    }
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
          await applyToAndConfirm(ctx, session, text);
          return;
        }
        if (session.step === "confirm") {
          await remindConfirm(ctx, session);
          return;
        }
        if (session.step === "body") {
          if (!text) {
            await sayInline(ctx, md2Esc("请发送回复正文"), wizardCancelKb());
            return;
          }
          session.body = text;
          session.step = "confirm";
          session.confirmLabel = "确认回复";
          session.idem = crypto.randomUUID();
          await putSession(ctx.env, userId, session);
          await postConfirm(ctx, session, userId, promptMailConfirm(session, ctx.env, "确认回复"));
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
  const message = buildMailPushMessage(email);
  const kb = inboundMailKb(mailViewUrl(env, email.id), email.id);

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
