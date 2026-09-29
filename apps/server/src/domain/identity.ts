// Пользователи playground (web_user_1234) — песочница веб-чата: им ничего не отправляется.
const PLAYGROUND_USER = /^web_user_\d{1,10}$/;

export type Platform = 'max' | 'playground';

export function isPlaygroundUserKey(key: string): boolean {
  return PLAYGROUND_USER.test(key);
}

export function parseUserKey(key: string): { platform: Platform; chatId: string } {
  return { platform: isPlaygroundUserKey(key) ? 'playground' : 'max', chatId: key };
}
