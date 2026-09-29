import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'crypto';
import Fastify, { FastifyInstance } from 'fastify';
import { config } from '../src/config.js';
import { verifyAndParseInitData } from '../src/domain/security.js';
import { parseUserKey } from '../src/domain/identity.js';
import { registerApiRoutes } from '../src/api/routes.js';
import { getDb, Database } from '../src/db/index.js';

function signInitData(token: string, userId: string | number): string {
  const params: Record<string, string> = {
    auth_date: '1727440000',
    query_id: 'query_1',
    user: JSON.stringify({ id: userId, first_name: 'Тест' }),
  };
  const dataCheckString = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...params, hash }).toString();
}

describe('5. initData: без обходов проверки подписи', () => {
  it('Токен-заглушка не отключает проверку HMAC', () => {
    const forged = signInitData('attacker_token', '777');
    expect(() => verifyAndParseInitData(forged, 'mock_token')).toThrow(/HMAC/);
  });

  it('Тестовый test_user_id работает только с токеном-заглушкой', () => {
    const raw = 'test_user_id=5&hash=x';
    expect(verifyAndParseInitData(raw, 'test_bot_token').user.id).toBe('5');
    expect(() => verifyAndParseInitData(raw, 'real_bot_token')).toThrow();
  });
});

describe('6. Пользователи playground отделены от пользователей MAX', () => {
  it('Песочница web_user_* распознаётся, остальные ID — пользователи MAX', () => {
    expect(parseUserKey('123')).toEqual({ platform: 'max', chatId: '123' });
    expect(parseUserKey('web_user_4242').platform).toBe('playground');
  });
});

describe('7. REST API: пользователь определяется только по подписи', () => {
  let db: Database;
  let app: FastifyInstance;
  const demoToken = config.botToken;

  beforeAll(async () => {
    db = await getDb();
    app = Fastify();
    registerApiRoutes(app, db);
    await app.ready();
  });

  afterEach(() => {
    config.botToken = demoToken;
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  const me = (headers: Record<string, string>) => app.inject({ method: 'GET', url: '/api/me', headers });

  it('Боевой токен: X-User-Id и ?user_id= без подписи отклоняются', async () => {
    config.botToken = 'real_bot_token';
    expect((await me({ 'x-user-id': '42' })).statusCode).toBe(401);
    const byQuery = await app.inject({ method: 'GET', url: '/api/me?user_id=42' });
    expect(byQuery.statusCode).toBe(401);
  });

  it('Боевой токен: подпись чужим токеном отклоняется, даже вместе с X-User-Id', async () => {
    config.botToken = 'real_bot_token';
    const res = await me({ 'x-max-init-data': signInitData('attacker_token', '42'), 'x-user-id': '42' });
    expect(res.statusCode).toBe(401);
  });

  it('Боевой токен: корректный initData MAX пропускается', async () => {
    config.botToken = 'real_bot_token';
    const res = await me({ 'x-max-init-data': signInitData('real_bot_token', 5001) });
    expect(res.statusCode).toBe(200);
    expect(res.json().max_user_id).toBe('5001');
  });

  it('Токен-заглушка: для локальной разработки работает X-User-Id', async () => {
    const res = await me({ 'x-user-id': 'dev_user' });
    expect(res.statusCode).toBe(200);
    expect(res.json().max_user_id).toBe('dev_user');
  });

  it('Боевой токен: playground доступен только для песочницы web_user_*', async () => {
    config.botToken = 'real_bot_token';
    const interact = (userId: string) =>
      app.inject({ method: 'POST', url: '/api/test/interact', payload: { userId, action: 'command', value: '/my' } });
    expect((await interact('5001')).statusCode).toBe(403);
    expect((await interact('web_user_1234')).statusCode).toBe(200);
  });
});
