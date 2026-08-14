/**
 * Google 翻译（思路来自 free-google-translate）
 * @see https://github.com/VictorZhang2014/free-google-translate
 */

export type TranslateResult = {
  originalText: string;
  sourceLang: string;
  text: string;
  targetLang: string;
};

const TARGET = "zh-CN";
const MAX_CHARS = 4500;
const DEFAULT_TKK = "434674.96463358";

/** token.js 中的 uo / wo，用于 webapp client */
function uo(a: number, b: string): number {
  let x = a >>> 0;
  for (let c = 0; c < b.length - 2; c += 3) {
    const ch = b.charAt(c + 2);
    let d = ch >= "a" ? ch.charCodeAt(0) - 87 : Number(ch);
    d = b.charAt(c + 1) === "+" ? x >>> d : x << d;
    x = b.charAt(c) === "+" ? (x + d) >>> 0 : x ^ d;
  }
  return x >>> 0;
}

function googleTk(q: string, tkk: string): string {
  const d = tkk.split(".");
  const b = Number(d[0]);
  const e: number[] = [];
  let f = 0;
  for (let g = 0; g < q.length; g++) {
    let h = q.charCodeAt(g);
    if (h < 128) e[f++] = h;
    else if (h < 2048) e[f++] = (h >> 6) | 192;
    else {
      if ((h & 64512) === 55296 && g + 1 < q.length && (q.charCodeAt(g + 1) & 64512) === 56320) {
        h = 65536 + ((h & 1023) << 10) + (q.charCodeAt(++g) & 1023);
        e[f++] = (h >> 18) | 240;
        e[f++] = ((h >> 12) & 63) | 128;
      } else e[f++] = (h >> 12) | 224;
      e[f++] = ((h >> 6) & 63) | 128;
      e[f++] = (h & 63) | 128;
    }
  }
  let a = b;
  for (f = 0; f < e.length; f++) {
    a += e[f];
    a = uo(a, "+-a^+6");
  }
  a = uo(a, "+-3^+b+-f");
  a ^= Number(d[1]) || 0;
  if (a < 0) a = (a & 2147483647) + 2147483648;
  a %= 1e6;
  return `${a}.${a ^ b}`;
}

function parseResponse(data: unknown, targetLang: string): TranslateResult | null {
  if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
  let text = "";
  for (const item of data[0]) {
    if (Array.isArray(item) && item[0]) text += item[0];
  }
  const row = data[0][0];
  const originalText = Array.isArray(row) && row[1] != null ? String(row[1]) : "";
  const sourceLang = typeof data[2] === "string" ? data[2] : "auto";
  if (!text.trim()) return null;
  return { originalText, sourceLang, text: text.trim(), targetLang };
}

async function fetchTranslate(url: URL): Promise<TranslateResult | null> {
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "*/*",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) return null;
  try {
    return parseResponse(await res.json(), url.searchParams.get("tl") ?? TARGET);
  } catch {
    return null;
  }
}

async function translateGtx(text: string, targetLang: string): Promise<TranslateResult | null> {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", targetLang);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);
  return fetchTranslate(url);
}

/** free-google-translate 使用的 webapp + tk 方式 */
async function translateWebapp(text: string, targetLang: string): Promise<TranslateResult | null> {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "webapp");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", targetLang);
  url.searchParams.set("dt", "t");
  url.searchParams.set("tk", googleTk(text, DEFAULT_TKK));
  url.searchParams.set("q", text);
  return fetchTranslate(url);
}

export function looksNonChinese(text: string): boolean {
  const t = text.replace(/\s+/g, "");
  if (!t || t === "(没有正文)") return false;
  const cjk = (t.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) ?? []).length;
  return cjk / t.length < 0.4;
}

export function isChineseLang(code: string): boolean {
  return /^zh(-|$)/i.test(code);
}

export async function translateToChinese(text: string): Promise<TranslateResult> {
  const q = text.trim().slice(0, MAX_CHARS);
  if (!q) throw new Error("empty");

  let result = await translateGtx(q, TARGET);
  if (!result) result = await translateWebapp(q, TARGET);
  if (!result) throw new Error("translate failed");
  return result;
}
