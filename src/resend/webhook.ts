import type { Env } from "../env";
import { notifyBounce, notifyInbound } from "../bot/createBot";
import { getReceived } from "../lib/resend";
import { markProcessed, sentOwner } from "../lib/kv";
import { asList, notifyAddresses, parseFromAddress } from "../lib/text";
import { verifySvix } from "../lib/svix";

type ResendEvent = {
  type?: string;
  data?: {
    email_id?: string;
    to?: string[];
    received_for?: string[];
    from?: string;
    subject?: string;
    bounce?: { message?: string };
  };
};

export async function handleResendWebhook(env: Env, request: Request): Promise<Response> {
  const payload = await request.text();
  const id = request.headers.get("svix-id") ?? "";
  const timestamp = request.headers.get("svix-timestamp") ?? "";
  const signature = request.headers.get("svix-signature") ?? "";
  if (!id || !timestamp || !signature) {
    return new Response("missing signature headers", { status: 400 });
  }
  try {
    await verifySvix({
      secret: env.RESEND_WEBHOOK_SECRET,
      payload,
      id,
      timestamp,
      signature,
    });
  } catch {
    return new Response("invalid webhook", { status: 400 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(payload) as ResendEvent;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  if (event.type === "email.bounced") {
    const emailId = event.data?.email_id;
    if (emailId) {
      const owner = await sentOwner(env, emailId);
      if (owner) {
        const fresh = await markProcessed(env, `${id}:bounce`, emailId);
        if (fresh) {
          const reason = event.data?.bounce?.message || event.data?.subject || emailId;
          try {
            await notifyBounce(env, owner, reason);
          } catch (e) {
            console.error("bounce notify", e);
            await env.MAIL_KV.delete(`svix:${id}:bounce`);
            await env.MAIL_KV.delete(`email:${emailId}`);
            return new Response("notify failed", { status: 500 });
          }
        }
      }
    }
    return new Response("ok");
  }

  if (event.type !== "email.received") {
    return new Response("ok");
  }

  const emailId = event.data?.email_id;
  if (!emailId) return new Response("ok");

  const allow = notifyAddresses(env.NOTIFY_ADDRESSES);
  if (allow.length) {
    const recipients = [...asList(event.data?.to), ...asList(event.data?.received_for)].map((s) =>
      parseFromAddress(s).toLowerCase(),
    );
    if (!recipients.some((r) => allow.includes(r))) {
      return new Response("ok");
    }
  }

  const { data, error, status } = await getReceived(env.RESEND_API_KEY, emailId);
  if (!data) {
    if (status === 404) return new Response("ok");
    return new Response(error || "fetch failed", { status: 500 });
  }

  const fresh = await markProcessed(env, id, emailId);
  if (!fresh) return new Response("ok");

  try {
    await notifyInbound(env, data);
  } catch (e) {
    console.error("inbound notify", e);
    await env.MAIL_KV.delete(`svix:${id}`);
    await env.MAIL_KV.delete(`email:${emailId}`);
    return new Response("notify failed", { status: 500 });
  }
  return new Response("ok");
}
