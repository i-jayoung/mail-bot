import type { ReceivedEmail } from "../env";
import { extractCodeFromEmail } from "./extract";
import { md2Code, md2Esc, md2Link } from "./md2";
import { asList, parseFromAddress } from "./text";

/** 段落之间单空行（勿在数组里再插 ""，否则会变成双空行） */
export function gapLines(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join("\n\n");
}

/** 字段行之间仅换行，不再插空段 */
export function fieldBlock(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join("\n");
}

function shortAddr(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m?.[1] ?? from).trim();
}

export function prefixOf(to: string[] | string | undefined): string {
  const first = asList(to)[0];
  if (!first) return "?";
  return parseFromAddress(first);
}

/** 两字标签与「验证码」三字对齐 */
function padLabel(label: string): string {
  return label.length < 3 ? `${label}\u3000` : label;
}

export function fieldLine(icon: string, label: string, value: string): string {
  return `${icon} ${md2Esc(padLabel(label))} ${md2Code(value)}`;
}

export function fieldLinkLine(icon: string, label: string, value: string): string {
  const url = value.includes("@") ? `mailto:${value}` : value;
  return `${icon} ${md2Esc(padLabel(label))} ${md2Link(value, url)}`;
}

function mailHeader(mail: ReceivedEmail): string {
  const toAddr = prefixOf(mail.to);
  const from = shortAddr(mail.from);
  const code = extractCodeFromEmail(mail);

  const blocks: string[] = [
    fieldLinkLine("👤", "发件", from),
    fieldLine("📥", "收件", toAddr),
  ];
  if (code) blocks.push(fieldLine("🔐", "验证码", code));

  return fieldBlock(...blocks);
}

export function buildMailPushMessage(
  mail: Pick<ReceivedEmail, "from" | "to" | "subject" | "text" | "html">,
  push = true,
): string {
  void push;
  return mailHeader(mail as ReceivedEmail);
}
