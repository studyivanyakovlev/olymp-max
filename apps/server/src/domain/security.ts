import crypto from 'crypto';
import { config, isDemoToken } from '../config.js';

export interface InitDataUser {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface ParsedInitData {
  user: InitDataUser;
  auth_date: number;
  query_id?: string;
  hash: string;
  raw: Record<string, string>;
}

/**
 * Валидация подписи initData от MAX Bridge (по стандарту HMAC-SHA256).
 * Telegram WebApp подписывает initData тем же алгоритмом, но своим токеном.
 * @param initDataRaw Строка параметров WebApp.initData из заголовка
 * @param botToken Токен бота, которым подписана строка
 */
export function verifyAndParseInitData(initDataRaw: string, botToken: string = config.botToken): ParsedInitData {
  if (!initDataRaw) {
    throw new Error('Отсутствует строка WebApp.initData');
  }

  const urlParams = new URLSearchParams(initDataRaw);
  const hash = urlParams.get('hash');
  
  if (!hash) {
    throw new Error('Отсутствует параметр hash в initData');
  }

  // Тестовый обход работает только с токеном-заглушкой (локальная разработка без MAX)
  if (isDemoToken(botToken) && initDataRaw.startsWith('test_user_id=')) {
    const userId = urlParams.get('test_user_id') || '12345';
    return {
      user: { id: userId, username: 'test_dev_user' },
      auth_date: Math.floor(Date.now() / 1000),
      hash: 'dev_mock_hash',
      raw: Object.fromEntries(urlParams.entries()),
    };
  }

  // Сборка строки data-check-string (все параметры кроме hash, отсортированные по алфавиту)
  const items: string[] = [];
  const rawObj: Record<string, string> = {};

  Array.from(urlParams.entries())
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) // побайтовая сортировка ключей, как в спецификации
    .forEach(([key, val]) => {
      items.push(`${key}=${val}`);
      rawObj[key] = val;
    });

  const dataCheckString = items.join('\n');

  // MAX Bridge алгоритм: secret_key = HMAC_SHA256("WebAppData", botToken)
  // hex_hash = HMAC_SHA256(secret_key, dataCheckString)
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const expected = Buffer.from(calculatedHash, 'hex');
  const received = Buffer.from(hash, 'hex');
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    throw new Error('Недействительная подпись initData (HMAC mismatch)');
  }

  const userJson = urlParams.get('user');
  let user: InitDataUser;
  if (userJson) {
    try {
      user = JSON.parse(userJson);
    } catch {
      throw new Error('Некорректный JSON в поле user');
    }
  } else {
    const rawId = urlParams.get('user_id') || urlParams.get('id');
    if (!rawId) {
      throw new Error('В initData отсутствует идентификатор пользователя');
    }
    user = { id: rawId };
  }

  const authDate = parseInt(urlParams.get('auth_date') || '0', 10);

  return {
    user,
    auth_date: authDate,
    query_id: urlParams.get('query_id') || undefined,
    hash,
    raw: rawObj,
  };
}
