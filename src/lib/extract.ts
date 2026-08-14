import { htmlToText } from "./text";

/** 验证码 token：4–16 位，数字或字母 */
const TOKEN = "[0-9A-Za-z]{4,16}";
const GAP = "[^0-9A-Za-z\\n]{0,40}";
const SEP = "(?:is|are|was|lautet|ist|es|est|è|é|son|sont|era|ser[aá]|je|jste|z|je|です|입니다|为|為|是|là|la)?\\s*(?:[:：#\\-]|\\b)";

/** 多语言 OTP 上下文关键词（用于判断该行/段是否在讲验证码） */
const OTP_CONTEXT =
  /验证码|驗證碼|校验码|校驗碼|动态码|動態碼|安全码|安全碼|确认码|確認碼|激活码|激活碼|一次性|認証(?:コード|番号)?|確認(?:コード|番号)?|検証|ワンタイム|パスコード|인증(?:번호|코드)?|확인(?:번호|코드)?|일회용|verification|verify|confirm|confirmation|activation|authenticate|authentication|auth(?:entication)?|security|passcode|password|sign[\s-]?in|log[\s-]?in|\botp\b|\bpin\b|\b2fa\b|\bmfa\b|\btoken\b|two[\s-]?factor|one[\s-]?time|access code|login code|v[eé]rification|v[eé]rifier|confirmer|authentification|connexion|mot de passe|best[aä]tigung|verifizierung|authentifizierung|anmelde|einmal|sicherheit|verificaci[oó]n|confirmaci[oó]n|autenticaci[oó]n|inicio de sesi[oó]n|contrase[nñ]a|c[oó]digo|verifica[cç][aã]o|confirma[cç][aã]o|autentica[cç][aã]o|senha|verifica|conferma|autenticazione|codice|verificatie|bevestiging|authenticatie|weryfikacj|potwierdzen|jednorazow|do[gğ]rulama|onay|kod|kode|verifikasi|konfirmasi|x[aá]c minh|x[aá]c nh[aậ]n|m[aã]|รหัส|ยืนยัน|подтвержден|верификац|аутентификац|код/i;

/** 各语言「code / 验证码」标签后的 token */
function labeled(pattern: string, score: number, flags = ""): { re: RegExp; score: number } {
  return { re: new RegExp(pattern.replace(/\$\{GAP\}/g, GAP), flags), score };
}

const LABELED: Array<{ re: RegExp; score: number }> = [
  // 中文
  { re: /验证码[^0-9A-Za-z\n]{0,40}([0-9A-Za-z]{4,16})\b/, score: 100 },
  { re: /驗證碼[^0-9A-Za-z\n]{0,40}([0-9A-Za-z]{4,16})\b/, score: 100 },
  { re: /(?:校验|校驗|动态|動態|安全|确认|確認|激活)码[^0-9A-Za-z\n]{0,30}([0-9A-Za-z]{4,16})\b/, score: 98 },
  { re: /(?:为|為|是|：|:)\s*([0-9A-Za-z]{4,16})(?:\s*(?:是|为|為)?(?:您的|你的)?(?:验证码|驗證碼|校验码))?/i, score: 88 },
  {
    re: /([0-9A-Za-z]{4,16})\s*(?:是|为|為)\s*(?:您的|你的)?(?:验证码|驗證碼|校验码|security code|verification code)/i,
    score: 90,
  },
  { re: /使用\s*([0-9A-Za-z]{4,16})\s*(?:来|來)?(?:验证|驗證|设置|設置|完成)/, score: 90 },
  { re: /^([0-9A-Za-z]{4,16})\s*验证码/m, score: 88 },

  // 日文
  labeled("認証(?:コード|番号)${GAP}([0-9A-Za-z]{4,16})\\b", 100),
  labeled("確認(?:コード|番号)${GAP}([0-9A-Za-z]{4,16})\\b", 98),
  labeled("(?:ワンタイム|パス)(?:コード|パスワード)?${GAP}([0-9A-Za-z]{4,16})\\b", 96),
  { re: /([0-9A-Za-z]{4,16})\s*(?:を)?(?:入力|ご利用)/, score: 85 },

  // 韩文
  labeled("인증(?:번호|코드)${GAP}([0-9A-Za-z]{4,16})\\b", 100),
  labeled("확인(?:번호|코드)${GAP}([0-9A-Za-z]{4,16})\\b", 98),
  { re: /([0-9A-Za-z]{4,16})\s*(?:을|를)\s*(?:입력|사용)/, score: 85 },

  // 英文
  {
    re: /(?:verification|security|confirmation|authentication|login|access|one[\s-]time(?: password)?)\s*code[^0-9A-Za-z\n]{0,40}([0-9A-Za-z]{4,16})\b/i,
    score: 98,
  },
  { re: /\b(?:otp|pin|2fa|mfa)\b[^0-9A-Za-z\n]{0,30}([0-9A-Za-z]{4,16})\b/i, score: 95 },
  {
    re: /(?:your|the|use|enter|following|below)\s+(?:code|otp|pin)\s*(?:is|:|：|#|-)\s*([0-9A-Za-z]{4,16})\b/i,
    score: 94,
  },
  { re: /(?:code|otp|pin)\s*(?:is|:|：|#|-)\s*([0-9A-Za-z]{4,16})\b/i, score: 92 },
  { re: /^([0-9A-Za-z]{4,16})\s+is your\b/im, score: 85 },

  // 法文
  labeled(
    "(?:code(?:\\s+de)?\\s+(?:v[eé]rification|confirmation|connexion|s[eé]curit[eé])|votre\\s+code)${GAP}([0-9A-Za-z]{4,16})\\b",
    98,
    "i",
  ),
  labeled("(?:entrez|saisissez|utilisez)\\s+(?:le\\s+)?code${GAP}([0-9A-Za-z]{4,16})\\b", 92, "i"),

  // 德文
  labeled(
    "(?:best[aä]tigungscode|verifizierungscode|sicherheitscode|anmeldecode|einmalpasswort)${GAP}([0-9A-Za-z]{4,16})\\b",
    98,
    "i",
  ),
  labeled("(?:ihr|dein)\\s+code${GAP}([0-9A-Za-z]{4,16})\\b", 94, "i"),

  // 西班牙文 / 葡萄牙文
  labeled(
    "c[oó]digo\\s+de\\s+(?:verificaci[oó]n|confirmaci[oó]n|acceso|seguridad|autenticaci[oó]n)${GAP}([0-9A-Za-z]{4,16})\\b",
    98,
    "i",
  ),
  labeled(
    "c[oó]digo\\s+de\\s+(?:verifica[cç][aã]o|confirma[cç][aã]o|acesso|seguran[cç]a|autentica[cç][aã]o)${GAP}([0-9A-Za-z]{4,16})\\b",
    98,
    "i",
  ),
  labeled("(?:su|tu|seu|sua)\\s+c[oó]digo${GAP}([0-9A-Za-z]{4,16})\\b", 94, "i"),

  // 意大利文
  labeled("codice\\s+(?:di\\s+)?(?:verifica|conferma|accesso|sicurezza)${GAP}([0-9A-Za-z]{4,16})\\b", 98, "i"),
  labeled("(?:il\\s+tuo|tuo)\\s+codice${GAP}([0-9A-Za-z]{4,16})\\b", 94, "i"),

  // 荷兰文
  labeled("verificatiecode|bevestigingscode|inlogcode${GAP}([0-9A-Za-z]{4,16})\\b", 98, "i"),

  // 俄文
  labeled("(?:код(?:\\s+подтверждения|\\s+верификации|\\s+доступа)?|ваш\\s+код)${GAP}([0-9A-Za-z]{4,16})\\b", 98, "i"),

  // 越南文
  labeled("m[aã]\\s+(?:x[aá]c\\s+(?:minh|nh[aậ]n)|b[aảo]\\s+m[aậ]t)${GAP}([0-9A-Za-z]{4,16})\\b", 98, "i"),

  // 印尼文 / 马来文
  labeled("kode\\s+(?:verifikasi|konfirmasi|keamanan|otp)${GAP}([0-9A-Za-z]{4,16})\\b", 98, "i"),

  // 土耳其文
  labeled("do[gğ]rulama\\s+kod(?:u|unuz)?${GAP}([0-9A-Za-z]{4,16})\\b", 98, "i"),

  // 波兰文
  labeled("kod\\s+(?:weryfikacyjny|potwierdzaj[aą]cy|jednorazowy)${GAP}([0-9A-Za-z]{4,16})\\b", 98, "i"),

  // 泰文
  labeled("รหัส(?:ยืนยัน|OTP|otp)?${GAP}([0-9A-Za-z]{4,16})\\b", 98),

  // 通用：主题行、有效期
  { re: /^([0-9A-Za-z]{4,16})\s*[-–—|:]\s/m, score: 85 },
  labeled(
    "(?:expires?|valid|minutes?|minute|有效|过期|過期|minuten|minutos|minuti|минут|นาที|phút|dakika)${GAP}([0-9A-Za-z]{4,16})\\b",
    70,
    "i",
  ),
  labeled(
    "([0-9A-Za-z]{4,16})${GAP}(?:expires?|valid for|minutes?|minute|有效|过期|過期|minuten|minutos|minuti|минут|นาที|phút|dakika)",
    70,
    "i",
  ),
];

/** 各语言 code / codigo / kod 等关键词（scanEmbedded 用） */
const CODE_LABEL =
  /(?:\bcode\b|\bcodigo\b|\bc[oó]digo\b|\bcodice\b|\bkod(?:u|unuz|u)?\b|\bkode\b|コード|認証(?:コード|番号)?|確認(?:コード|番号)?|인증(?:번호|코드)?|확인(?:번호|코드)?|c[oó]digo|verificatiecode|best[aä]tigungscode|verifizierungscode|подтверждения?|код|m[aã]|รหัส(?:ยืนยัน)?)/i;

const SPACED_DIGIT = /\b(\d{3})[\s-](\d{3})\b/g;

/** 常见英文单词，避免误识别为验证码 */
const STOP = new Set([
  "EMAIL",
  "GMAIL",
  "YAHOO",
  "CLICK",
  "LINK",
  "YOUR",
  "THIS",
  "THAT",
  "FROM",
  "HTTP",
  "HTTPS",
  "WWW",
  "COM",
  "NET",
  "ORG",
  "THE",
  "AND",
  "FOR",
  "NOT",
  "ARE",
  "YOU",
  "HAS",
  "WAS",
  "VERIFY",
  "LOGIN",
  "INBOX",
  "MAIL",
  "TEAM",
  "HELLO",
  "PLEASE",
  "HERE",
  "TOKEN",
  "CODE",
  "WITH",
  "HAVE",
  "WILL",
  "BEEN",
  "THAN",
  "THAT",
  "WHAT",
  "WHEN",
  "WHERE",
  "WHICH",
  "ABOUT",
  "AFTER",
  "BEFORE",
  "KODUNUZ",
  "KODU",
]);

function lineContext(line: string): boolean {
  return OTP_CONTEXT.test(line) || CODE_LABEL.test(line);
}

function isLikelyOtp(code: string, hasContext = false): boolean {
  const c = code.trim();
  if (!c || c.length < 4 || c.length > 16) return false;

  if (/^\d+$/.test(c)) {
    if (/^(19|20)\d{2}$/.test(c)) return false;
    if (/^(\d)\1+$/.test(c)) return false;
    if (/^0+$/.test(c)) return false;
    if (c.length === 11 && c.startsWith("1")) return false;
    return true;
  }

  if (/^[A-Za-z0-9]+$/.test(c)) {
    if (/^(.)\1+$/i.test(c)) return false;
    if (/\d/.test(c)) return true;
    return hasContext && /^[A-Za-z]{4,16}$/.test(c);
  }

  return false;
}

function addCandidate(map: Map<string, number>, code: string, score: number, hasContext = false) {
  const c = code.trim();
  if (!isLikelyOtp(c, hasContext)) return;
  const key = c.toUpperCase();
  if (STOP.has(key)) return;
  map.set(key, Math.max(map.get(key) ?? 0, score));
}

function scanLabeled(text: string, map: Map<string, number>, boost = 0) {
  const t = text.replace(/\r\n/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return;
  const ctx = lineContext(t);
  for (const { re, score } of LABELED) {
    const m = t.match(re);
    if (m?.[1]) addCandidate(map, m[1], score + boost, ctx);
  }
  for (const m of t.matchAll(SPACED_DIGIT)) {
    const joined = m[1] + m[2];
    if (lineContext(t.slice(Math.max(0, (m.index ?? 0) - 80), (m.index ?? 0) + 80))) {
      addCandidate(map, joined, 75 + boost, true);
    }
  }
}

/** 行末、粘连、code 关键词后的 token */
function scanEmbedded(text: string, map: Map<string, number>, boost = 0) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const tokenRe = new RegExp(`\\b(${TOKEN})\\b`, "g");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const ctx = lineContext(line);

    const lead = line.match(new RegExp(`^(${TOKEN})\\s*[-–—|:]`));
    if (lead?.[1]) addCandidate(map, lead[1], 96 + boost, true);

    const codeAfter = line.match(
      new RegExp(
        `(?:\\bcode\\b|\\bcodigo\\b|\\bc[oó]digo\\b|\\bcodice\\b|\\bkod(?:u|unuz|u)?\\b|\\bkode\\b|コード|認証(?:コード|番号)?|確認(?:コード|番号)?|인증(?:번호|코드)?|확인(?:번호|코드)?|m[aã]|รหัส(?:ยืนยัน)?|код)\\s*${SEP}?\\s*(${TOKEN})\\b`,
        "i",
      ),
    );
    if (codeAfter?.[1]) addCandidate(map, codeAfter[1], 93 + boost, true);

    const trailSpace = line.match(new RegExp(`\\s(${TOKEN})$`));
    if (trailSpace?.[1]) addCandidate(map, trailSpace[1], (ctx ? 90 : 78) + boost, ctx);

    const gluedDigits = line.match(/[A-Za-z]{2,}([0-9]{4,16})$/);
    if (gluedDigits?.[1]) addCandidate(map, gluedDigits[1], (ctx ? 88 : 80) + boost, ctx);

    const gluedMix = line.match(new RegExp(`[A-Za-z]{2,}(${TOKEN})$`));
    if (gluedMix?.[1] && /\d/.test(gluedMix[1])) {
      addCandidate(map, gluedMix[1], (ctx ? 85 : 76) + boost, ctx);
    }

    if (line.length <= 24 && !/\s/.test(line)) {
      addCandidate(map, line, (ctx ? 82 : 58) + boost, ctx);
    }

    if (ctx) {
      for (const m of line.matchAll(tokenRe)) {
        const tok = m[1];
        if (tok && tok.length >= 4) addCandidate(map, tok, 68 + boost, true);
      }
    }
  }
}

function scanHtml(html: string, map: Map<string, number>) {
  const h = html.trim();
  if (!h) return;

  const tagPatterns = [
    /<(?:strong|b|h[1-4]|td|span|p|div)[^>]*>\s*([0-9A-Za-z]{4,16})\s*<\//gi,
    /font-size:\s*(?:2[4-9]|[3-9]\d|\d{3})px[^>]*>\s*([0-9A-Za-z]{4,16})\s*<\//gi,
  ];
  for (const re of tagPatterns) {
    for (const m of h.matchAll(re)) {
      if (m[1]) addCandidate(map, m[1], 84, true);
    }
  }

  scanLabeled(htmlToText(h), map, 5);
  scanEmbedded(htmlToText(h), map, 5);
}

function pickBest(map: Map<string, number>): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const [code, score] of map) {
    const better =
      score > bestScore ||
      (score === bestScore &&
        best &&
        /^\d+$/.test(code) &&
        !/^\d+$/.test(best));
    if (better) {
      best = code;
      bestScore = score;
    }
  }
  return bestScore >= 55 ? best : null;
}

export type CodeMail = {
  subject?: string | null;
  text?: string | null;
  html?: string | null;
};

export function extractCodeFromEmail(mail: CodeMail): string | null {
  const map = new Map<string, number>();
  const subject = mail.subject?.trim() ?? "";
  const text = mail.text?.trim() ?? "";
  const html = mail.html?.trim() ?? "";
  const body = text || (html ? htmlToText(html) : "");

  if (subject) {
    scanLabeled(subject, map, 15);
    scanEmbedded(subject, map, 15);
  }
  if (body) {
    scanLabeled(body, map, 0);
    scanEmbedded(body, map, 0);
  }
  if (html) scanHtml(html, map);

  return pickBest(map);
}

/** @deprecated 使用 extractCodeFromEmail */
export function extractCode(text: string): string | null {
  return extractCodeFromEmail({ text });
}

export function extractLinks(html?: string | null, text?: string | null): string[] {
  const SKIP = /unsubscribe|list-unsubscribe|mailto:|cid:|tracking|pixel|beacon/i;
  const PRIORITY = /verify|confirm|activate|validation|otp|code|token|signin|sign-in|login/i;

  const found: string[] = [];
  const hrefs = html?.matchAll(/href\s*=\s*["']([^"']+)["']/gi) ?? [];
  for (const m of hrefs) found.push(m[1]);
  const urls = `${html ?? ""}\n${text ?? ""}`.matchAll(/https?:\/\/[^\s<>"')\]]+/gi);
  for (const m of urls) found.push(m[0]);

  const cleaned = found
    .map((u) => u.replace(/[),.;]+$/, ""))
    .filter((u) => /^https?:\/\//i.test(u))
    .filter((u) => !SKIP.test(u) && u.length < 500);

  const uniq: string[] = [];
  for (const u of cleaned) {
    if (!uniq.includes(u)) uniq.push(u);
  }
  uniq.sort((a, b) => Number(PRIORITY.test(b)) - Number(PRIORITY.test(a)));
  return uniq.slice(0, 3);
}
