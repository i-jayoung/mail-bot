export interface Env {
  MAIL_KV: KVNamespace;
  RESEND_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  RESEND_WEBHOOK_SECRET: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  FROM_EMAIL: string;
  ALLOWED_USER_IDS: string;
  NOTIFY_ADDRESSES?: string;
  PUBLIC_URL?: string;
}

export type Subscriber = { id: number; chat: number };

export type SendSession = {
  type: "send";
  step: "from" | "to" | "body" | "confirm";
  body: string;
  from?: string;
  to?: string;
  subject?: string;
  /** 确认页标题（发信 / 回复） */
  confirmLabel?: string;
  /** 待确认消息，便于发送/取消后删除 */
  confirmChat?: number;
  confirmMsg?: number;
  idem?: string;
  expires: number;
};

export type Session = SendSession;

export type ReceivedListItem = {
  id: string;
  to: string[];
  from: string;
  created_at: string;
  subject: string | null;
  message_id?: string;
  reply_to?: string[];
  attachments?: { id: string; filename: string | null; size?: number }[];
};

export type ReceivedEmail = ReceivedListItem & {
  html: string | null;
  text: string | null;
  headers?: Record<string, string>;
  received_for?: string[];
};
