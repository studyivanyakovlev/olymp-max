import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import path from 'path';
import { adjustForQuietHours, generateRemindersForSubscription, handleReminderAction } from '../src/domain/reminders.js';
import { verifyAndParseInitData } from '../src/domain/security.js';
import { findDataFile, validateDataset, importDataset } from '../src/db/seed.js';
import { getDb, Database } from '../src/db/index.js';

describe('1. Тестирование валидации датасета и контракта схемы', () => {
  const schemaPath = findDataFile('data/schema.json');
  const olympiadsPath = findDataFile('data/olympiads.json');

  it('Основной датасет олимпиад соответствует JSON Schema', async () => {
    const data = JSON.parse(await import('fs').then(fs => fs.readFileSync(olympiadsPath, 'utf-8')));
    const valid = await validateDataset(schemaPath, data);
    expect(valid).toBe(true);
  });

  it('Битый датасет с пропущенным полем отклоняется с понятной ошибкой', async () => {
    const invalidData = [
      {
        id: 'broken-olympiad',
        title: 'Тест',
        // отсутствует organizer, subjects, stages и т.д.
      },
    ];

    await expect(validateDataset(schemaPath, invalidData)).rejects.toThrow(
      /Ошибка валидации датасета против схемы/
    );
  });
});

describe('2. Тестирование тихих часов (09:00–21:00)', () => {
  it('Ночное время (03:00) сдвигается на 09:00 того же дня', () => {
    // 2026-10-15 03:00 UTC (06:00 MSK)
    const early = new Date('2026-10-15T03:00:00.000Z');
    const adjusted = adjustForQuietHours(early, { timezone: 'Europe/Moscow', quietFrom: '22:00', quietTo: '08:00' });
    
    // В Москве должно быть 09:00
    const mskHour = parseInt(
      new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Moscow', hour: 'numeric', hour12: false }).format(adjusted),
      10
    );
    expect(mskHour).toBe(9);
  });

  it('Поздний вечер (23:30) сдвигается на утро следующего дня', () => {
    const late = new Date('2026-10-15T20:30:00.000Z'); // 23:30 MSK
    const adjusted = adjustForQuietHours(late, { timezone: 'Europe/Moscow', quietFrom: '22:00', quietTo: '08:00' });

    const mskHour = parseInt(
      new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Moscow', hour: 'numeric', hour12: false }).format(adjusted),
      10
    );
    expect(mskHour).toBe(9);
    expect(adjusted.getTime()).toBeGreaterThan(late.getTime());
  });

  it('Дневное время (14:15) в разрешённом окне не сдвигается', () => {
    const day = new Date('2026-10-15T11:15:00.000Z'); // 14:15 MSK
    const adjusted = adjustForQuietHours(day, { timezone: 'Europe/Moscow', quietFrom: '22:00', quietTo: '08:00' });
    expect(adjusted.getTime()).toBe(day.getTime());
  });
});

describe('3. Безопасность: проверка HMAC-SHA256 подписи initData', () => {
  const botToken = 'secret_bot_token_test_123';

  function generateValidInitData(token: string, userId: string): string {
    const params = new Map<string, string>();
    params.set('auth_date', '1727440000');
    params.set('query_id', 'query_12345');
    params.set('user', JSON.stringify({ id: userId, username: 'test_student' }));

    const items = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`);
    const dataCheckString = items.join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    params.set('hash', hash);

    return Array.from(params.entries())
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }

  it('Корректная подпись initData успешно проходит валидацию', () => {
    const raw = generateValidInitData(botToken, '424242');
    const parsed = verifyAndParseInitData(raw, botToken);
    expect(parsed.user.id).toBe('424242');
    expect(parsed.user.username).toBe('test_student');
  });

  it('Поддельная подпись initData отклоняется с ошибкой', () => {
    const raw = generateValidInitData(botToken, '424242');
    const tampered = raw.replace('hash=', 'hash=fake_invalid_hash_');
    expect(() => verifyAndParseInitData(tampered, 'different_token')).toThrow();
  });
});

describe('4. База данных и логика напоминаний', () => {
  let db: Database;
  let testUserId: number;
  let testSubId: number;

  beforeAll(async () => {
    db = await getDb();
    const olyPath = findDataFile('data/olympiads.json');
    const demoPath = findDataFile('data/demo.json');
    await importDataset(olyPath, db);
    await importDataset(demoPath, db);

    // Создаем тестового пользователя
    const uRes = await db.query(
      `INSERT INTO users (max_user_id, grade, timezone, quiet_from, quiet_to)
       VALUES ('unit_test_user', 10, 'Europe/Moscow', '22:00', '08:00')
       ON CONFLICT (max_user_id) DO UPDATE SET updated_at = NOW()
       RETURNING id`
    );
    testUserId = uRes.rows[0].id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('Подписка на демо-олимпиаду генерирует напоминание через 1 минуту', async () => {
    const subRes = await db.query(
      `INSERT INTO subscriptions (user_id, olympiad_id, status)
       VALUES ($1, 'demo-jury-olympiad', 'interested')
       ON CONFLICT (user_id, olympiad_id) DO UPDATE SET status = 'interested'
       RETURNING id`,
      [testUserId]
    );
    testSubId = subRes.rows[0].id;

    const count = await generateRemindersForSubscription(db, testSubId, 'demo-jury-olympiad', testUserId);
    expect(count).toBe(1);

    const remRes = await db.query(
      `SELECT kind, send_at, status FROM reminders WHERE subscription_id = $1`,
      [testSubId]
    );
    expect(remRes.rowCount).toBe(1);
    expect(remRes.rows[0].kind).toBe('demo_1m');
    expect(remRes.rows[0].status).toBe('pending');
  });

  it('Кнопка «Зарегистрировался» отменяет регистрационные напоминания и меняет статус', async () => {
    const actRes = await handleReminderAction(db, testSubId, 'registered');
    expect(actRes.success).toBe(true);

    const subCheck = await db.query('SELECT status FROM subscriptions WHERE id = $1', [testSubId]);
    expect(subCheck.rows[0].status).toBe('registered');

    const remCheck = await db.query('SELECT status FROM reminders WHERE subscription_id = $1', [testSubId]);
    expect(remCheck.rows[0].status).toBe('cancelled');
  });
});
