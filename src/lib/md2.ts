const MD2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;

/** Escape plain text for MarkdownV2 outside formatting entities. */
export function md2Esc(s: string): string {
  return s.replace(MD2_SPECIAL, (c) => `\\${c}`);
}

export function md2Bold(s: string): string {
  return `*${md2Esc(s)}*`;
}

export function md2Italic(s: string): string {
  return `_${md2Esc(s)}_`;
}

export function md2Code(s: string): string {
  return `\`${s.replace(/[`\\]/g, (c) => `\\${c}`)}\``;
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

function md2LinkLabel(s: string): string {
  return s.replace(/[\\\]]/g, (c) => `\\${c}`);
}

export function md2Link(label: string, url: string): string {
  const safeUrl = url.replace(/[\\)]/g, (c) => `\\${c}`);
  return `[${md2LinkLabel(label)}](${safeUrl})`;
}

/** Format email/plain body for MarkdownV2: escape text, linkify URLs, keep newlines. */
export function md2Body(raw: string, max?: number): string {
  let text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  if (max !== undefined && text.length > max) text = `${text.slice(0, max)}…`;

  const urlRe = new RegExp(URL_RE.source, URL_RE.flags);
  const out: string[] = [];
  let last = 0;
  for (const m of text.matchAll(urlRe)) {
    const i = m.index ?? 0;
    if (i > last) out.push(md2Esc(text.slice(last, i)));
    const url = m[0].replace(/[),.;]+$/g, "");
    const host = url.replace(/^https?:\/\//i, "").split(/[/?#]/)[0] ?? url;
    const label = host.length > 42 ? `${host.slice(0, 39)}…` : host;
    out.push(md2Link(label, url));
    last = i + m[0].length;
  }
  if (last < text.length) out.push(md2Esc(text.slice(last)));
  return out.join("");
}

export function md2Quote(text: string): string {
  const t = text.trim();
  if (!t) return "";
  return t
    .split("\n")
    .map((line) => `> ${md2Esc(line)}`)
    .join("\n");
}

/** Strip MarkdownV2 formatting for plain-text fallback. */
export function stripMd2(s: string): string {
  return s
    .replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^> /gm, "");
}
