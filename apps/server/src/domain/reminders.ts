import { Database } from '../db/index.js';

export interface QuietHoursConfig {
  timezone: string;
  quietFrom: string; // e.g. "22:00"
  quietTo: string;   // e.g. "08:00"
}

/**
 * Сдвигает время отправки в окно активности 09:00–21:00 с учётом тихих часов пользователя
 * (Правило 2: "Время отправки сдвигается в окно 09:00–21:00 по часовому поясу региона и обходит тихие часы пользователя")
 */
export function adjustForQuietHours(date: Date, config: QuietHoursConfig = { timezone: 'Europe/Moscow', quietFrom: '22:00', quietTo: '08:00' }): Date {
  const result = new Date(date.getTime());
  
  // Получаем локальные часы и минуты в целевом часовом поясе
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone || 'Europe/Moscow',
    hour12: false,
    hour: 'numeric',
    minute: 'numeric',
  });
  
  const parts = formatter.formatToParts(result);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '12', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);

  const [qFromH] = (config.quietFrom || '22:00').split(':').map(Number);
  const [qToH] = (config.quietTo || '08:00').split(':').map(Number);

  // Активное окно: от max(9, qToH) до min(21, qFromH)
  const windowStart = Math.max(9, qToH);
  const windowEnd = Math.min(21, qFromH);

  if (hour < windowStart) {
    // Слишком рано — сдвигаем на начало активного окна сегодня
    const diffHours = windowStart - hour;
    result.setHours(result.getHours() + diffHours, 0, 0, 0);
  } else if (hour >= windowEnd) {
    // Слишком поздно — переносим на утро следующего дня (windowStart)
    const hoursUntilMidnight = 24 - hour;
    const diffHours = hoursUntilMidnight + windowStart;
    result.setHours(result.getHours() + diffHours, 0, 0, 0);
  }

  return result;
}

/**
 * Генерация напоминаний при оформлении подписки
 * Правило 1, 7, 8
 */
export async function generateRemindersForSubscription(
  db: Database,
  subscriptionId: number,
  olympiadId: string,
  userId: number
): Promise<number> {
  const now = new Date();

  // 1. Получаем профиль пользователя для часового пояса и тихих часов
  const userRes = await db.query(
    'SELECT timezone, quiet_from, quiet_to FROM users WHERE id = $1',
    [userId]
  );
  const userConfig: QuietHoursConfig = userRes.rows[0]
    ? {
        timezone: userRes.rows[0].timezone,
        quietFrom: userRes.rows[0].quiet_from,
        quietTo: userRes.rows[0].quiet_to,
      }
    : { timezone: 'Europe/Moscow', quietFrom: '22:00', quietTo: '08:00' };

  // 2. Получаем олимпиаду и этапы
  const olyRes = await db.query('SELECT is_demo, title FROM olympiads WHERE id = $1', [olympiadId]);
  if (olyRes.rowCount === 0) return 0;
  const isDemo = olyRes.rows[0].is_demo;

  const stagesRes = await db.query(
    'SELECT id, kind, name, starts_at, ends_at FROM stages WHERE olympiad_id = $1',
    [olympiadId]
  );

  let createdCount = 0;

  // ДЕМО-РЕЖИМ ДЛЯ ЖЮРИ:
  // "Её этапы считаются от момента подписки, первое напоминание приходит через 1 минуту"
  if (isDemo) {
    const demoStageId = stagesRes.rows[0]?.id || 'demo-stage-reg';
    const sendAt = new Date(now.getTime() + 60 * 1000); // ровно через 1 минуту

    await db.query(
      `INSERT INTO reminders (subscription_id, stage_id, kind, send_at, status)
       VALUES ($1, $2, 'demo_1m', $3, 'pending')
       ON CONFLICT (subscription_id, stage_id, kind) DO UPDATE SET
         send_at = EXCLUDED.send_at,
         status = 'pending'`,
      [subscriptionId, demoStageId, sendAt.toISOString()]
    );
    return 1;
  }

  // ОБЫЧНЫЕ ОЛИМПИАДЫ:
  for (const stage of stagesRes.rows) {
    const start = new Date(stage.starts_at);
    const end = new Date(stage.ends_at);

    const candidates: Array<{ kind: string; targetDate: Date }> = [];

    if (stage.kind === 'registration') {
      // 1. Старт регистрации
      candidates.push({ kind: 'reg_start', targetDate: start });

      // 2. За 3 дня до закрытия
      const d3 = new Date(end.getTime() - 3 * 24 * 3600 * 1000);
      candidates.push({ kind: 'reg_3d', targetDate: d3 });

      // 3. За 1 день до закрытия
      const d1 = new Date(end.getTime() - 1 * 24 * 3600 * 1000);
      candidates.push({ kind: 'reg_1d', targetDate: d1 });
    } else if (stage.kind === 'qualifying' || stage.kind === 'final') {
      // 4. За 1 день до тура
      const tourD1 = new Date(start.getTime() - 1 * 24 * 3600 * 1000);
      candidates.push({ kind: 'stage_1d', targetDate: tourD1 });
    }

    for (const cand of candidates) {
      // Моменты в прошлом пропускаются (Правило 1)
      if (cand.targetDate <= now) {
        continue;
      }

      // Сдвигаем в активное окно
      const sendAt = adjustForQuietHours(cand.targetDate, userConfig);

      // Вставляем с защитой от дублей (Правило 7)
      const res = await db.query(
        `INSERT INTO reminders (subscription_id, stage_id, kind, send_at, status)
         VALUES ($1, $2, $3, $4, 'pending')
         ON CONFLICT (subscription_id, stage_id, kind) DO NOTHING`,
        [subscriptionId, stage.id, cand.kind, sendAt.toISOString()]
      );

      if (res.rowCount > 0) {
        createdCount++;
      }
    }
  }

  return createdCount;
}

/**
 * Обработка действий пользователя по кнопкам напоминания
 * Правило 5:
 * «Зарегистрировался» отменяет напоминания о регистрации и оставляет о турах
 * «Напомнить завтра» создаёт новое на +24 часа
 * «Не участвую» отменяет все
 */
export async function handleReminderAction(
  db: Database,
  subscriptionId: number,
  action: 'registered' | 'remind_tomorrow' | 'drop'
): Promise<{ success: boolean; message: string }> {
  const subRes = await db.query(
    `SELECT s.id, s.user_id, s.olympiad_id, o.title, u.timezone, u.quiet_from, u.quiet_to
     FROM subscriptions s
     JOIN olympiads o ON o.id = s.olympiad_id
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`,
    [subscriptionId]
  );

  if (subRes.rowCount === 0) {
    return { success: false, message: 'Подписка не найдена' };
  }

  const sub = subRes.rows[0];

  if (action === 'registered') {
    // Обновляем статус подписки
    await db.query(`UPDATE subscriptions SET status = 'registered', updated_at = NOW() WHERE id = $1`, [subscriptionId]);
    // Отменяем только напоминания о регистрации, оставляем туры
    await db.query(
      `UPDATE reminders SET status = 'cancelled', updated_at = NOW()
       WHERE subscription_id = $1 AND kind IN ('reg_start', 'reg_3d', 'reg_1d', 'demo_1m') AND status = 'pending'`,
      [subscriptionId]
    );

    // Фиксируем событие
    await db.query(
      `INSERT INTO events (user_id, name, props) VALUES ($1, 'registered_confirmed', $2)`,
      [sub.user_id, JSON.stringify({ subscription_id: subscriptionId, olympiad_id: sub.olympiad_id })]
    );

    return {
      success: true,
      message: `🎉 Отлично! Статус обновлён на «Зарегистрирован». Напоминания о регистрации отключены, мы обязательно напомним о предстоящих турах!`,
    };
  }

  if (action === 'remind_tomorrow') {
    const userConfig: QuietHoursConfig = {
      timezone: sub.timezone,
      quietFrom: sub.quiet_from,
      quietTo: sub.quiet_to,
    };
    const targetDate = new Date(Date.now() + 24 * 3600 * 1000);
    const sendAt = adjustForQuietHours(targetDate, userConfig);

    // Ищем подходящий этап для привязки
    const stageRes = await db.query(
      `SELECT stage_id FROM reminders WHERE subscription_id = $1 ORDER BY id DESC LIMIT 1`,
      [subscriptionId]
    );
    const stageId = stageRes.rows[0]?.stage_id || 'custom';

    await db.query(
      `INSERT INTO reminders (subscription_id, stage_id, kind, send_at, status)
       VALUES ($1, $2, 'custom', $3, 'pending')`,
      [subscriptionId, stageId, sendAt.toISOString()]
    );

    return {
      success: true,
      message: `⏰ Договорились! Напомню завтра в ${sendAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`,
    };
  }

  if (action === 'drop') {
    await db.query(`UPDATE subscriptions SET status = 'dropped', updated_at = NOW() WHERE id = $1`, [subscriptionId]);
    await db.query(
      `UPDATE reminders SET status = 'cancelled', updated_at = NOW()
       WHERE subscription_id = $1 AND status = 'pending'`,
      [subscriptionId]
    );

    return {
      success: true,
      message: `Вы отписались от напоминаний по олимпиаде «${sub.title}».`,
    };
  }

  return { success: false, message: 'Неизвестное действие' };
}

/**
 * Пересчёт напоминаний при сдвиге дат этапа (Правило 6)
 */
export async function recalculateStageReminders(
  db: Database,
  stageId: string,
  olympiadTitle: string,
  stageName: string,
  newStart: string,
  newEnd: string
): Promise<void> {
  const start = new Date(newStart);
  const end = new Date(newEnd);
  const now = new Date();

  // Находим все pending напоминания для этого этапа
  const remRes = await db.query(
    `SELECT r.id, r.kind, r.subscription_id, u.timezone, u.quiet_from, u.quiet_to, u.max_user_id
     FROM reminders r
     JOIN subscriptions s ON s.id = r.subscription_id
     JOIN users u ON u.id = s.user_id
     WHERE r.stage_id = $1 AND r.status = 'pending'`,
    [stageId]
  );

  for (const rem of remRes.rows) {
    let newTarget: Date | null = null;
    if (rem.kind === 'reg_start') newTarget = start;
    else if (rem.kind === 'reg_3d') newTarget = new Date(end.getTime() - 3 * 24 * 3600 * 1000);
    else if (rem.kind === 'reg_1d') newTarget = new Date(end.getTime() - 1 * 24 * 3600 * 1000);
    else if (rem.kind === 'stage_1d') newTarget = new Date(start.getTime() - 1 * 24 * 3600 * 1000);

    if (newTarget && newTarget > now) {
      const userConfig: QuietHoursConfig = {
        timezone: rem.timezone,
        quietFrom: rem.quiet_from,
        quietTo: rem.quiet_to,
      };
      const adjusted = adjustForQuietHours(newTarget, userConfig);

      await db.query(
        `UPDATE reminders SET send_at = $1, updated_at = NOW() WHERE id = $2`,
        [adjusted.toISOString(), rem.id]
      );
    }
  }
}
