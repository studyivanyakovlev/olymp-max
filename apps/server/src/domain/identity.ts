// Пользователи MAX и Telegram хранятся в одной таблице users (колонка max_user_id).
// ID Telegram записываются с префиксом tg_, чтобы не совпасть с ID пользователей MAX:
// иначе напоминание одного человека могло бы уйти другому.
// Пользователи веб-playground (web_user_1234) — песочница: им ничего не отправляется.
const TELEGRAM_PREFIX = 'tg_';
const PLAYGROUND_USER = /^web_user_\d{1,10}$/;

export type Platform = 'max' | 'telegram' | 'playground';

export function telegramUserKey(telegramId: string | number): string {
  return `${TELEGRAM_PREFIX}${telegramId}`;
}

export function isPlaygroundUserKey(key: string): boolean {
  return PLAYGROUND_USER.test(key);
}

export function parseUserKey(key: string): { platform: Platform; chatId: string } {
  if (key.startsWith(TELEGRAM_PREFIX)) return { platform: 'telegram', chatId: key.slice(TELEGRAM_PREFIX.length) };
  if (isPlaygroundUserKey(key)) return { platform: 'playground', chatId: key };
  return { platform: 'max', chatId: key };
}
