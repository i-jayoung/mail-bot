import type { ReceivedEmail } from "../env";
import { md2Bold, md2Code } from "./md2";
import { asList, parseFromAddress } from "./text";

function blocks(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join("\n\n");
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

function mailHeader(mail: ReceivedEmail, push: boolean): string {
  const pfx = prefixOf(mail.to);
  const title = push ? `📬 新邮件 · ${pfx}` : `📬 ${pfx}`;
  return blocks(md2Bold(title), `👤 来自 ${md2Code(shortAddr(mail.from))}`);
}

export function buildMailPushMessage(mail: Pick<ReceivedEmail, "from" | "to">, push = true): string {
  return mailHeader(mail as ReceivedEmail, push);
}
