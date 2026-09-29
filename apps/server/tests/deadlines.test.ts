import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { pickNextDeadline, getRecommendationsForUser, StageRow } from '../src/domain/recommendations.js';
import { adjustForQuietHours, generateRemindersForSubscription, handleReminderAction } from '../src/domain/reminders.js';
import { buildReminderText } from '../src/scheduler/index.js';
import { deadlineLine } from '../src/bot/handlers.js';
import { formatRange, formatDeadline } from '../src/domain/dates.js';
import { findDataFile, importDataset } from '../src/db/seed.js';
import { getDb, Database } from '../src/db/index.js';

const NOW = new Date('2026-09-29T12:00:00+03:00');

const stage = (kind: StageRow['kind'], name: string, starts_at: string, ends_at: string): StageRow => ({
  olympiad_id: 'x',
  kind,
  name,
  starts_at,
  ends_at,
});

describe('8. Ближайший дедлайн олимпиады', () => {
  it('Открытая регистрация важнее тура, берётся та, что закрывается раньше', () => {
    const { next, registrationClosed } = pickNextDeadline(
      [
        stage('registration', 'Регистрация на второй тур', '2026-09-07T00:00:00+03:00', '2026-10-31T23:59:00+03:00'),
        stage('registration', 'Регистрация на первый тур', '2026-09-07T00:00:00+03:00', '2026-10-10T23:59:00+03:00'),
        stage('qualifying', 'Первый тур', '2026-10-11T00:00:00+03:00', '2026-10-11T23:59:00+03:00'),
      ],
      NOW
    );
    expect(registrationClosed).toBe(false);
    expect(next?.stage_name).toBe('Регистрация на первый тур');
    expect(deadlineLine(next)).toBe('⏰ Регистрация на первый тур — до 10 октября, 23:59 (МСК)');
  });

  it('Регистрация закрыта: олимпиада помечается закрытой, ближайшим считается тур', () => {
    const { next, registrationClosed } = pickNextDeadline(
      [
        stage('registration', 'Регистрация', '2026-09-01T00:00:00+03:00', '2026-09-22T23:59:00+03:00'),
        stage('qualifying', 'Отборочный тур', '2026-10-24T00:00:00+03:00', '2026-10-25T23:59:00+03:00'),
      ],
      NOW
    );
    expect(registrationClosed).toBe(true);
    expect(deadlineLine(next)).toBe('📝 Отборочный тур — 24–25 октября');
  });

  it('Все этапы в прошлом: дедлайна нет', () => {
    const { next } = pickNextDeadline(
      [stage('final', 'Финал', '2026-03-01T00:00:00+03:00', '2026-03-02T23:59:00+03:00')],
      NOW
    );
    expect(next).toBeNull();
  });

  it('Даты выводятся по-русски и по Москве', () => {
    expect(formatRange('2026-10-30T00:00:00+03:00', '2026-11-02T23:59:00+03:00')).toBe('30 октября – 2 ноября');
    expect(formatDeadline('2026-10-10T20:59:00Z')).toBe('10 октября, 23:59 (МСК)');
  });
});

describe('8a. Тихие часы «Круглосуточно»', () => {
  it('Если тихие часы отключены, время напоминания не сдвигается', () => {
    const late = new Date('2026-10-15T20:30:00.000Z'); // 23:30 МСК
    const adjusted = adjustForQuietHours(late, { timezone: 'Europe/Moscow', quietFrom: '00:00', quietTo: '00:00' });
    expect(adjusted.getTime()).toBe(late.getTime());
  });
});

describe('9. Тексты напоминаний содержат этап и дату', () => {
  const base = {
    oly_title: 'Физтех',
    stage_name: 'Регистрация на первый тур',
    stage_starts_at: '2026-09-07T00:00:00+03:00',
    stage_ends_at: '2026-10-10T23:59:00+03:00',
    timezone: 'Europe/Moscow',
    rsosh_level: 2,
  };

  it('За 3 дня до конца регистрации', () => {
    const text = buildReminderText({ ...base, kind: 'reg_3d' });
    expect(text).toContain('Регистрация на первый тур');
    expect(text).toContain('10 октября, 23:59 (МСК)');
    expect(text).toContain('2 уровень');
  });

  it('За день до тура', () => {
    const text = buildReminderText({
      ...base,
      kind: 'stage_1d',
      stage_name: 'Первый тур',
      stage_starts_at: '2026-10-11T00:00:00+03:00',
      stage_ends_at: '2026-10-11T23:59:00+03:00',
    });
    expect(text).toContain('Первый тур');
    expect(text).toContain('11 октября');
  });
});

describe('10. Подборка и напоминания на реальном датасете', () => {
  let db: Database;
  let userId: number;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    db = await getDb();
    await importDataset(findDataFile('data/olympiads.json'), db);
    await importDataset(findDataFile('data/demo.json'), db);
    const u = await db.query(`INSERT INTO users (max_user_id, grade) VALUES ('deadline_user', 11) RETURNING id`);
    userId = u.rows[0].id;
    await db.query(`INSERT INTO user_subjects (user_id, subject_code) VALUES ($1, 'math')`, [userId]);
  });

  afterAll(async () => {
    vi.useRealTimers();
    await db.close();
  });

  it('В подборке нет олимпиад с закрытой регистрацией, у каждой есть дедлайн', async () => {
    const list = await getRecommendationsForUser(db, userId, 50);
    expect(list.length).toBeGreaterThan(1);
    // «Высшая проба» по этим профилям: регистрация закрылась 22.09.2026
    const closed = ['hse-vp-math', 'hse-vp-biology', 'hse-vp-economics', 'hse-vp-social'];
    expect(list.filter((o) => closed.includes(o.id))).toEqual([]);
    // а у профиля «Разработка кода» регистрация открыта до 21.10
    expect(list.some((o) => o.id === 'hse-vp-devcode')).toBe(true);
    for (const o of list.filter((o) => !o.is_demo)) {
      expect(o.next_deadline).toBeTruthy();
    }
    // Олимпиады по математике идут раньше олимпиад по другим предметам
    const real = list.filter((o) => !o.is_demo);
    const firstOther = real.findIndex((o) => !o.subjects.includes('math'));
    const lastMath = real.map((o) => o.subjects.includes('math')).lastIndexOf(true);
    if (firstOther !== -1) expect(lastMath).toBeLessThan(firstOther);
  });

  it('Подписка считает созданные напоминания, повторная подписка возвращает отменённые', async () => {
    const sub = await db.query(
      `INSERT INTO subscriptions (user_id, olympiad_id) VALUES ($1, 'phystech-math') RETURNING id`,
      [userId]
    );
    const subId = sub.rows[0].id;
    const created = await generateRemindersForSubscription(db, subId, 'phystech-math', userId);
    expect(created).toBeGreaterThan(0);

    await handleReminderAction(db, subId, 'drop', userId);
    const again = await generateRemindersForSubscription(db, subId, 'phystech-math', userId);
    expect(again).toBe(created);
  });
});
