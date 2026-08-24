import type { Env, Session, Subscriber } from "../env";
import type { MailViewRecord } from "./mailView";
import { allowedIds } from "./text";

const SESSION_TTL = 30 * 60;

export function sessionKey(userId: number): string {
  return `session:${userId}`;
}

export async function getSession(env: Env, userId: number): Promise<Session | null> {
  const raw = await env.MAIL_KV.get(sessionKey(userId), "json");
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Session;
  if (s.expires && s.expires < Date.now()) {
    await clearSession(env, userId);
    return null;
  }
  return s;
}

export async function putSession(env: Env, userId: number, session: Session): Promise<void> {
  session.expires = Date.now() + SESSION_TTL * 1000;
  await env.MAIL_KV.put(sessionKey(userId), JSON.stringify(session), {
    expirationTtl: SESSION_TTL,
  });
}

export async function clearSession(env: Env, userId: number): Promise<void> {
  await env.MAIL_KV.delete(sessionKey(userId));
}

export async function getSubscribers(env: Env): Promise<Subscriber[]> {
  const raw = await env.MAIL_KV.get("subscribers", "json");
  return Array.isArray(raw) ? (raw as Subscriber[]) : [];
}

export async function addSubscriber(env: Env, userId: number, chatId: number): Promise<void> {
  const list = await getSubscribers(env);
  const existing = list.find((s) => s.id === userId);
  if (existing?.chat === chatId) return;
  const next = list.filter((s) => s.id !== userId);
  next.push({ id: userId, chat: chatId });
  await env.MAIL_KV.put("subscribers", JSON.stringify(next));
}

export async function getAllowlist(env: Env): Promise<number[]> {
  const fromEnv = allowedIds(env.ALLOWED_USER_IDS);
  const extra = (await env.MAIL_KV.get("allowlist", "json")) as number[] | null;
  return [...new Set([...fromEnv, ...(Array.isArray(extra) ? extra : [])])];
}

export async function ensureAllowed(env: Env, userId: number): Promise<boolean> {
  const fromEnv = allowedIds(env.ALLOWED_USER_IDS);
  const list = await getAllowlist(env);
  if (list.includes(userId)) return true;
  if (fromEnv.length === 0 && list.length === 0) {
    await env.MAIL_KV.put("allowlist", JSON.stringify([userId]));
    return true;
  }
  return false;
}

export async function markProcessed(env: Env, svixId: string, emailId?: string): Promise<boolean> {
  if (emailId) {
    const ek = `email:${emailId}`;
    if (await env.MAIL_KV.get(ek)) return false;
  }
  const key = `svix:${svixId}`;
  if (await env.MAIL_KV.get(key)) return false;
  await env.MAIL_KV.put(key, "1", { expirationTtl: 7 * 24 * 3600 });
  if (emailId) {
    await env.MAIL_KV.put(`email:${emailId}`, "1", { expirationTtl: 7 * 24 * 3600 });
  }
  return true;
}

export async function mapSent(env: Env, emailId: string, userId: number): Promise<void> {
  await env.MAIL_KV.put(`sent:${emailId}`, String(userId), { expirationTtl: 14 * 24 * 3600 });
}

export async function sentOwner(env: Env, emailId: string): Promise<number | null> {
  const v = await env.MAIL_KV.get(`sent:${emailId}`);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function getLastFrom(env: Env, userId: number): Promise<string | null> {
  const v = await env.MAIL_KV.get(`lastfrom:${userId}`);
  return v?.trim() || null;
}

export async function putLastFrom(env: Env, userId: number, from: string): Promise<void> {
  await env.MAIL_KV.put(`lastfrom:${userId}`, from);
}

export async function getLastTo(env: Env, userId: number): Promise<string | null> {
  const v = await env.MAIL_KV.get(`lastto:${userId}`);
  return v?.trim() || null;
}

export async function putLastTo(env: Env, userId: number, to: string): Promise<void> {
  await env.MAIL_KV.put(`lastto:${userId}`, to);
}

const MAIL_VIEW_TTL = 7 * 24 * 3600;

export async function putMailView(env: Env, emailId: string, mail: MailViewRecord): Promise<void> {
  await env.MAIL_KV.put(`mailview:${emailId}`, JSON.stringify(mail), { expirationTtl: MAIL_VIEW_TTL });
}

export async function getMailView(env: Env, emailId: string): Promise<MailViewRecord | null> {
  const raw = await env.MAIL_KV.get(`mailview:${emailId}`, "json");
  if (!raw || typeof raw !== "object") return null;
  return raw as MailViewRecord;
}
