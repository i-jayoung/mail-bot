import { InlineKeyboard } from "grammy";

export function removeReplyKb() {
  return { remove_keyboard: true as const };
}

export type PushKbOpts = {
  body?: string;
  code?: string | null;
  emailId?: string;
  translated?: boolean;
  /** 是否显示翻译/恢复切换（与当前展示语言无关） */
  translatable?: boolean;
};

export function pushKb(opts: PushKbOpts) {
  const { body, code, emailId, translated = false, translatable = false } = opts;
  const kb = new InlineKeyboard();
  const snippet = body?.trim();
  const hasBody = Boolean(snippet && snippet !== "(没有正文)");

  if (code?.trim()) {
    kb.copyText("📋 复制验证码", code.trim().slice(0, 256));
  }
  if (hasBody) {
    if (code?.trim()) kb.row();
    kb.copyText("📋 复制全文", snippet!.slice(0, 256));
  }
  if (emailId && translatable) {
    kb.row().text(translated ? "↩️ 恢复原文" : "🌐 翻译中文", translated ? `orig:${emailId}` : `tr:${emailId}`);
  }
  return kb;
}
