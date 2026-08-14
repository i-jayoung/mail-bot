export function formatShanghai(iso: string | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function mailDomain(fromEmail: string): string {
  const m = fromEmail.match(/@([^>\s]+)/);
  return (m?.[1] ?? "").trim().toLowerCase();
}

export function parseFromAddress(fromEmail: string): string {
  const m = fromEmail.match(/<([^>]+)>/);
  return (m?.[1] ?? fromEmail).trim();
}

export function asList(v: string[] | string | undefined | null): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

export function parseSendFrom(
  fromEmail: string,
  raw: string,
): { ok: true; value: string } | { ok: false; reason: "domain" | "invalid" } {
  const domain = mailDomain(fromEmail);
  const t = raw.trim().replace(/^⚙️\s*/, "");
  if (!t || /^(默认|default)$/i.test(t)) return { ok: true, value: fromEmail };
  if (!domain) return { ok: false, reason: "invalid" };

  const named = t.match(/^(.+?)\s*<([^<>]+)>$/);
  const emailPart = named ? named[2].trim() : t;
  const display = named ? named[1].trim().replace(/[<>]/g, "") : "";

  let local = emailPart;
  if (emailPart.includes("@")) {
    const at = emailPart.lastIndexOf("@");
    local = emailPart.slice(0, at);
    const host = emailPart.slice(at + 1).toLowerCase();
    if (host !== domain) return { ok: false, reason: "domain" };
  }

  const clean = local.replace(/[^a-z0-9._+-]/gi, "");
  if (!clean) return { ok: false, reason: "invalid" };
  const addr = `${clean}@${domain}`;
  return { ok: true, value: display ? `${display} <${addr}>` : addr };
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return btoa(binary);
}

export function allowedIds(raw: string | undefined): number[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function notifyAddresses(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function clip(text: string, max = 3500, more = "…后面太长，点「查看全文」或等文件。"): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n${more}`;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<a [^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2\n$1\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function emailBody(email: { html?: string | null; text?: string | null }): string {
  if (email.text?.trim()) return email.text.trim();
  if (email.html?.trim()) return htmlToText(email.html);
  return "(没有正文)";
}
