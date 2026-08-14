function b64(bytes: ArrayBuffer): string {
  let s = "";
  const u = new Uint8Array(bytes);
  for (const n of u) s += String.fromCharCode(n);
  return btoa(s);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function verifySvix(opts: {
  secret: string;
  payload: string;
  id: string;
  timestamp: string;
  signature: string;
}): Promise<void> {
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    throw new Error("webhook timestamp");
  }
  const raw = opts.secret.startsWith("whsec_") ? opts.secret.slice(6) : opts.secret;
  const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = new TextEncoder().encode(`${opts.id}.${opts.timestamp}.${opts.payload}`);
  const sig = b64(await crypto.subtle.sign("HMAC", key, data));
  const candidates = opts.signature
    .split(" ")
    .map((part) => part.split(",")[1])
    .filter(Boolean);
  if (!candidates.some((c) => timingSafeEqual(c, sig))) {
    throw new Error("webhook signature");
  }
}
