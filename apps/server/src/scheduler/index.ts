import { Database } from '../db/index.js';
import type { Api } from '@maxhub/max-bot-api';
import { keyboards } from '../bot/keyboards.js';
import { isDemoToken } from '../config.js';
import { createMaxApi } from '../bot/maxClient.js';
import { parseUserKey } from '../domain/identity.js';
import { formatDeadline, formatRange } from '../domain/dates.js';

export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private db: Database;
  private botApi: Api;

  constructor(db: Database, botApi?: Api) {
    this.db = db;
    this.botApi = botApi || createMaxApi();
  }

  public start(intervalMs: number = 60 * 1000) {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`⏱️ Планировщик напоминаний запущен (интервал: ${intervalMs / 1000} сек)`);

    // Первый запуск сразу
    this.tick().catch(err => console.error('Ошибка в цикле планировщика:', err));

    this.timer = setInterval(() => {
      this.tick().catch(err => console.error('Ошибка в цикле планировщика:', err));
    }, intervalMs);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log('Планировщик напоминаний остановлен');
  }

  /**
   * Один такт обработки очереди напоминаний
   */
  public async tick(): Promise<number> {
    const now = new Date().toISOString();

    // Правило 3: выборка пачки до 50 строк
    // Если PGlite, FOR UPDATE SKIP LOCKED поддерживается в полном объёме
    const selectQuery = this.db.isPGlite
      ? `SELECT r.id, r.subscription_id, r.stage_id, r.kind, r.send_at, r.attempts,
                s.user_id, s.olympiad_id, s.status as sub_status,
                u.max_user_id, u.timezone, o.title as oly_title, o.url as oly_url, o.rsosh_level,
                st.name as stage_name, st.starts_at as stage_starts_at, st.ends_at as stage_ends_at
         FROM reminders r
         JOIN subscriptions s ON s.id = r.subscription_id
         JOIN users u ON u.id = s.user_id
         JOIN olympiads o ON o.id = s.olympiad_id
         JOIN stages st ON st.id = r.stage_id
         WHERE r.status = 'pending' AND r.send_at <= $1 AND s.status != 'dropped'
         ORDER BY r.send_at ASC
         LIMIT 50`
      : `SELECT r.id, r.subscription_id, r.stage_id, r.kind, r.send_at, r.attempts,
                s.user_id, s.olympiad_id, s.status as sub_status,
                u.max_user_id, u.timezone, o.title as oly_title, o.url as oly_url, o.rsosh_level,
                st.name as stage_name, st.starts_at as stage_starts_at, st.ends_at as stage_ends_at
         FROM reminders r
         JOIN subscriptions s ON s.id = r.subscription_id
         JOIN users u ON u.id = s.user_id
         JOIN olympiads o ON o.id = s.olympiad_id
         JOIN stages st ON st.id = r.stage_id
         WHERE r.status = 'pending' AND r.send_at <= $1 AND s.status != 'dropped'
         ORDER BY r.send_at ASC
         LIMIT 50
         FOR UPDATE SKIP LOCKED`;

    const pending = await this.db.query(selectQuery, [now]);
    if (pending.rowCount === 0) {
      return 0;
    }

    console.log(`[Планировщик] Найдено напоминаний к отправке: ${pending.rowCount}`);

    let sentCount = 0;

    for (const rem of pending.rows) {
      // Троттлинг 20 запросов в сек (50 мс задержка между отправками)
      await new Promise(resolve => setTimeout(resolve, 50));

      const success = await this.sendSingleReminder(rem);
      if (success) {
        sentCount++;
        await this.db.query(
          `UPDATE reminders SET status = 'sent', updated_at = NOW() WHERE id = $1`,
          [rem.id]
        );
      } else {
        const nextAttempts = (rem.attempts || 0) + 1;
        if (nextAttempts >= 3) {
          // Правило 4: после третьей попытки статус failed
          await this.db.query(
            `UPDATE reminders SET status = 'failed', attempts = $1, updated_at = NOW() WHERE id = $2`,
            [nextAttempts, rem.id]
          );
          console.error(`[Планировщик] Напоминание ${rem.id} не отправлено после 3 попыток. Статус: failed`);
        } else {
          // Повтор через 5 минут
          const retryTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
          await this.db.query(
            `UPDATE reminders SET send_at = $1, attempts = $2, updated_at = NOW() WHERE id = $3`,
            [retryTime, nextAttempts, rem.id]
          );
          console.warn(`[Планировщик] Ошибка отправки напоминания ${rem.id}. Повтор в ${retryTime}`);
        }
      }
    }

    return sentCount;
  }

  private async sendSingleReminder(rem: any): Promise<boolean> {
    const text = buildReminderText(rem);
    const kb = keyboards.reminderButtons(rem.subscription_id, rem.oly_url);
    const { platform, chatId } = parseUserKey(String(rem.max_user_id));

    // Тестовый токен или пользователь playground: сообщение только пишется в лог
    if (isDemoToken() || platform === 'playground') {
      console.log(`\n📨 [Эмуляция отправки сообщения] -> Пользователь: ${chatId}`);
      console.log(`Текст: ${text}`);
      console.log(`Кнопки прикреплены к сообщению.`);
      return true;
    }

    try {
      await this.botApi.sendMessageToUser(Number(chatId), text, {
        attachments: [kb],
      });
      return true;
    } catch (err: any) {
      console.error(`Ошибка MAX Bot API при отправке пользователю ${chatId}:`, err.message);
      return false;
    }
  }
}

/** Текст напоминания: что за этап и до какой даты действовать */
export function buildReminderText(rem: any): string {
  const tz = rem.timezone || 'Europe/Moscow';
  const title = `🏆 «${rem.oly_title}»`;
  const stage = `📌 ${rem.stage_name}`;
  const deadline = rem.stage_ends_at ? formatDeadline(rem.stage_ends_at, tz) : null;
  const tourDates =
    rem.stage_starts_at && rem.stage_ends_at ? formatRange(rem.stage_starts_at, rem.stage_ends_at, tz) : null;

  const lines = (header: string, ...body: Array<string | null | false>) =>
    [header, '', title, stage, ...body.filter((line): line is string => typeof line === 'string')].join('\n');

  switch (rem.kind) {
    case 'demo_1m':
      return lines(
        '⚡ [ДЕМО ДЛЯ ЖЮРИ] Напоминание по олимпиаде!',
        deadline && `🗓 Регистрация до ${deadline}`,
        '',
        'Это демонстрационное напоминание: оно приходит через 1 минуту после подписки. ' +
          'Нажмите «Зарегистрировался» или используйте другие кнопки:'
      );
    case 'reg_start':
      return lines('🔔 Регистрация открыта!', `🗓 Подать заявку можно до ${deadline}. Не откладывай!`);
    case 'reg_3d':
      return lines(
        '⏳ До конца регистрации 3 дня',
        `🗓 Регистрация закрывается ${deadline}.`,
        rem.rsosh_level &&
          `Олимпиада из Перечня РСОШ (${rem.rsosh_level} уровень): диплом может дать льготу при поступлении.`
      );
    case 'reg_1d':
      return lines('🚨 Последний день регистрации!', `🗓 Регистрация закрывается ${deadline}. Подай заявку прямо сейчас:`);
    case 'stage_1d':
      return lines(
        '📝 Завтра начинается тур олимпиады!',
        `🗓 Даты тура: ${tourDates}`,
        'Проверь доступ в личный кабинет и подготовь черновики!'
      );
    default:
      return lines('⏰ Напоминание по олимпиаде', tourDates && `🗓 ${tourDates}`);
  }
}
