import { InlineKeyboard } from "grammy";

export function removeReplyKb() {
  return { remove_keyboard: true as const };
}

export function inboundMailKb(viewUrl: string, emailId: string) {
  return new InlineKeyboard().url("查看内容", viewUrl).text("回复", `reply:${emailId}`);
}

export function wizardCancelKb() {
  return new InlineKeyboard().text("取消", "cancel");
}

export function wizardConfirmKb() {
  return new InlineKeyboard().text("确认发送", "send:confirm").text("取消", "cancel");
}
