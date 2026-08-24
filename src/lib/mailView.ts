import type { Env, ReceivedEmail } from "../env";
import { emailBody } from "./text";

export type MailViewRecord = {
  from: string;
  to: string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  created_at?: string;
};

export function publicOrigin(env: Env): string {
  return (env.PUBLIC_URL || "https://mail.5o.vc").replace(/\/$/, "");
}

export function mailViewUrl(env: Env, emailId: string): string {
  return `${publicOrigin(env)}/mail/${encodeURIComponent(emailId)}`;
}

export function mailViewFromEmail(email: ReceivedEmail): MailViewRecord {
  const raw = email.text || email.html ? emailBody(email) : "";
  const text = raw && raw !== "(没有正文)" ? raw : null;
  return {
    from: email.from,
    to: email.to,
    subject: email.subject,
    html: email.html,
    text,
    created_at: email.created_at,
  };
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseEmail(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return (m?.[1] ?? addr).trim();
}

function formatWhen(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function bodyBlock(mail: MailViewRecord): string {
  const bodyHtml = mail.html?.trim();
  const bodyText = mail.text?.trim();
  if (bodyHtml) {
    return `<div class="article-inner"><div class="mail-html">${bodyHtml}</div></div>`;
  }
  if (bodyText) {
    return `<div class="article-inner"><pre class="mail-text">${escHtml(bodyText)}</pre></div>`;
  }
  return `<div class="mail-empty">（无正文）</div>`;
}

export function renderMailViewPage(mail: MailViewRecord): string {
  const subject = mail.subject?.trim() || "（无主题）";
  const fromAddr = parseEmail(mail.from);
  const toAddrs = mail.to.map(parseEmail).join(" · ");
  const when = formatWhen(mail.created_at);

  const bylineParts = [
    `<span><strong>发件</strong> ${escHtml(fromAddr)}</span>`,
    `<span><strong>收件</strong> ${escHtml(toAddrs)}</span>`,
    when ? `<span><strong>时间</strong> ${escHtml(when)}</span>` : "",
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="color-scheme" content="light" />
  <title>${escHtml(subject)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600;700&family=Noto+Sans+SC:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html {
      height: 100%;
      overflow-x: hidden;
      -webkit-text-size-adjust: 100%;
    }
    body {
      min-height: 100%;
      min-height: 100dvh;
      font-family: "Noto Sans SC", "PingFang SC", sans-serif;
      background: #faf8f5;
      color: #2c2417;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }
    .stage {
      min-height: 100dvh;
      display: grid;
      grid-template-rows: 1fr auto 1fr;
      justify-items: center;
      align-items: center;
      padding: clamp(24px, 6vmin, 56px);
      padding-left: max(clamp(24px, 6vmin, 56px), env(safe-area-inset-left));
      padding-right: max(clamp(24px, 6vmin, 56px), env(safe-area-inset-right));
      padding-top: max(clamp(24px, 6vmin, 56px), env(safe-area-inset-top));
      padding-bottom: max(clamp(24px, 6vmin, 56px), env(safe-area-inset-bottom));
    }
    .page {
      grid-row: 2;
      width: min(680px, 100%);
      max-width: 100%;
      min-width: 0;
    }
    .masthead {
      text-align: center;
      padding-bottom: clamp(20px, 4vw, 28px);
      border-bottom: 2px solid #2c2417;
      margin-bottom: clamp(20px, 4vw, 32px);
    }
    .masthead-label {
      font-size: 11px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: #8a7b6a;
      margin-bottom: 12px;
    }
    .subject {
      font-family: "Noto Serif SC", "Songti SC", serif;
      font-size: clamp(22px, 5.5vw, 36px);
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: -0.01em;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .byline {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: clamp(12px, 3vw, 16px) 0 clamp(18px, 4vw, 24px);
      border-bottom: 1px solid #d4cdc3;
      margin-bottom: clamp(20px, 4vw, 32px);
      font-size: clamp(13px, 3.2vw, 14px);
      color: #6b5f50;
      text-align: center;
    }
    .byline span {
      max-width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .byline strong {
      color: #2c2417;
      font-weight: 500;
    }
    .divider {
      text-align: center;
      margin: clamp(20px, 4vw, 28px) 0;
      font-size: 12px;
      color: #a89885;
      letter-spacing: 0.15em;
    }
    .divider::before,
    .divider::after {
      content: "";
      display: inline-block;
      width: clamp(24px, 8vw, 40px);
      height: 1px;
      background: #d4cdc3;
      vertical-align: middle;
      margin: 0 12px;
    }
    .article {
      background: #fff;
      border: 1px solid #e8e2d9;
      padding: clamp(16px, 4vw, 32px) clamp(14px, 3.5vw, 28px);
      max-width: 100%;
      min-width: 0;
      overflow: hidden;
    }
    .article-inner {
      max-width: 100%;
      min-width: 0;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .mail-html {
      max-width: 100%;
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
      line-height: 1.5;
    }
    .mail-html table {
      max-width: 100% !important;
      width: 100% !important;
      table-layout: fixed !important;
    }
    .mail-html img {
      max-width: 100% !important;
      height: auto !important;
    }
    .mail-html pre,
    .mail-html code {
      max-width: 100%;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .mail-text {
      max-width: 100%;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
      font: clamp(13px, 3.2vw, 14px)/1.7 ui-monospace, "Cascadia Code", Consolas, monospace;
      color: #334155;
    }
    .mail-empty {
      text-align: center;
      color: #a89885;
      padding: 32px 16px;
      font-size: 14px;
    }
    .footer-note {
      margin-top: clamp(20px, 4vw, 32px);
      text-align: center;
      font-size: 12px;
      color: #a89885;
    }
    @media (min-width: 540px) {
      .byline {
        flex-direction: row;
        flex-wrap: wrap;
        justify-content: center;
        gap: 12px 28px;
      }
    }
  </style>
</head>
<body>
  <main class="stage">
    <article class="page">
      <header class="masthead">
        <div class="masthead-label">Mail · 5o.vc</div>
        <h1 class="subject">${escHtml(subject)}</h1>
      </header>

      <div class="byline">${bylineParts.join("")}</div>

      <div class="divider">正文</div>

      <section class="article">${bodyBlock(mail)}</section>

      <p class="footer-note">— 邮件由 5o.vc 代收 —</p>
    </article>
  </main>
</body>
</html>`;
}
