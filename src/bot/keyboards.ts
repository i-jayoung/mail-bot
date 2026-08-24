import { InlineKeyboard } from "grammy";

export function removeReplyKb() {
  return { remove_keyboard: true as const };
}

export function viewMailKb(viewUrl: string) {
  return new InlineKeyboard().url("📖 查看全文", viewUrl);
}
