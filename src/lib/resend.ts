const UA = "mail-bot/1.0";

async function api<T>(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<{ data: T | null; error: string | null; status: number }> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("User-Agent", UA);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`https://api.resend.com${path}`, { ...init, headers });
  const json = (await res.json().catch(() => ({}))) as {
    message?: string;
    name?: string;
    id?: string;
  };
  if (!res.ok) {
    return {
      data: null,
      error: json.message || json.name || `Resend ${res.status}`,
      status: res.status,
    };
  }
  return { data: json as T, error: null, status: res.status };
}

export async function getReceived(apiKey: string, id: string) {
  return api<import("../env").ReceivedEmail>(apiKey, `/emails/receiving/${id}`);
}

export type SendPayload = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
};

export async function sendEmail(apiKey: string, payload: SendPayload, idempotencyKey?: string) {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey.slice(0, 256);
  const body: Record<string, unknown> = {
    from: payload.from,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
  };
  if (payload.html) body.html = payload.html;
  if (payload.headers) body.headers = payload.headers;
  return api<{ id: string }>(apiKey, "/emails", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
