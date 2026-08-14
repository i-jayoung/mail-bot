import type { ReceivedEmail } from "../env";
import { extractCodeFromEmail } from "./extract";
import { md2Bold, md2Code, md2Italic, md2Quote } from "./md2";
import { asList, emailBody, parseFromAddress } from "./text";

/** Telegram 单条消息上限；MD2 转义会膨胀，留余量 */
const TG_SAFE = 3600;
const MAX_PARTS = 12;

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

function mailHeader(mail: ReceivedEmail, push: boolean, code: string | null): string {
  const pfx = prefixOf(mail.to);
  const title = push ? `📬 新邮件 · ${pfx}` : `📬 ${pfx}`;
  return blocks(
    md2Bold(title),
    `👤 来自 ${md2Code(shortAddr(mail.from))}`,
    code ? `🔐 ${md2Code(code)}` : "",
  );
}

function formatBodyBlock(text: string): string {
  if (!text) return md2Italic("📭 （无正文）");
  return md2Quote(text);
}

/** 在 budget 内尽量多取 plain 正文 */
function takePlainChunk(text: string, budget: number): string {
  if (!text) return "";
  if (md2Quote(text).length <= budget) return text;

  let lo = 1;
  let hi = text.length;
  let best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let slice = text.slice(0, mid);
    const nl = slice.lastIndexOf("\n");
    if (nl > mid * 0.55) slice = slice.slice(0, nl + 1);
    if (md2Quote(slice).length <= budget) {
      best = slice.length;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return text.slice(0, best);
}

export type MailPushContent = {
  parts: string[];
  fullBody: string;
  /** 首条消息里展示的正文片段（plain） */
  bodyChunk: string;
  code: string | null;
  /** 超出 Telegram 分条上限，剩余内容仅随 txt 附件提供 */
  truncated: boolean;
};

export function buildFirstPushMessage(
  mail: Pick<ReceivedEmail, "from" | "to">,
  bodyPlain: string,
  code: string | null,
): string {
  const header = mailHeader(mail as ReceivedEmail, true, code);
  return blocks(header, formatBodyBlock(bodyPlain));
}

export function buildMailPushContent(mail: ReceivedEmail, push = true): MailPushContent {
  const raw = mail.text || mail.html ? emailBody(mail) : "";
  const code = extractCodeFromEmail(mail);
  const header = mailHeader(mail, push, code);
  const detailText = raw.replace(/\r\n/g, "\n").trim();
  const fullBody = detailText && detailText !== "(没有正文)" ? detailText : "";

  if (!fullBody) {
    return {
      parts: [blocks(header, formatBodyBlock(""))],
      fullBody: "",
      bodyChunk: "",
      code,
      truncated: false,
    };
  }

  const parts: string[] = [];
  let bodyChunk = "";
  let offset = 0;
  let index = 0;

  while (offset < fullBody.length && parts.length < MAX_PARTS) {
    const prefix =
      index === 0 ? header : blocks(md2Bold(`📄 正文续（${index + 1}）`));
    const budget = Math.max(400, TG_SAFE - prefix.length - 20);
    const chunk = takePlainChunk(fullBody.slice(offset), budget);
    if (!chunk) break;

    const bodyMd = formatBodyBlock(chunk);
    parts.push(index === 0 ? blocks(header, bodyMd) : blocks(prefix, bodyMd));
    if (index === 0) bodyChunk = chunk;
    offset += chunk.length;
    index++;
  }

  const truncated = offset < fullBody.length;
  if (truncated && parts.length) {
    const tail = fullBody.length - offset;
    parts[parts.length - 1] = blocks(
      parts[parts.length - 1],
      md2Italic(`✂️ 正文还有 ${tail} 字，请查看随附 mail.txt`),
    );
  }

  return {
    parts: parts.length ? parts : [blocks(header, formatBodyBlock(""))],
    fullBody,
    bodyChunk,
    code,
    truncated,
  };
}

/** 单条格式化（兼容旧调用） */
export function formatMailDetail(mail: ReceivedEmail, push = false): string {
  return buildMailPushContent(mail, push).parts[0] ?? "";
}

export function bodyCopySnippet(raw: string, code?: string | null): string {
  if (code?.trim()) return code.trim();
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t || t === "(没有正文)") return "";
  return t.slice(0, 256);
}

export function needsFullBodyFile(truncated: boolean): boolean {
  return truncated;
}
