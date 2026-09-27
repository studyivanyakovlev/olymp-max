import { Database } from '../db/index.js';
import { Bot, Api } from '@maxhub/max-bot-api';
import { keyboards } from '../bot/keyboards.js';
import { config } from '../config.js';

export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private db: Database;
  private botApi: Api;

  constructor(db: Database, botApi?: Api) {
    this.db = db;
    this.botApi = botApi || new Bot(config.botToken).api;
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
                u.max_user_id, o.title as oly_title, o.url as oly_url, st.name as stage_name
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
                u.max_user_id, o.title as oly_title, o.url as oly_url, st.name as stage_name
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
    const isDemo = rem.kind === 'demo_1m';
    let text = '';

    if (isDemo) {
      text =
        `⚡ [ДЕМО ДЛЯ ЖЮРИ] Напоминание по олимпиаде!\n\n` +
        `🏆 «${rem.oly_title}»\n` +
        `📌 Этап: ${rem.stage_name}\n\n` +
        `Это демонстрационное напоминание, настроенное на срабатывание через 1 минуту после оформления подписки. Нажмите «Зарегистрировался» или используйте другие кнопки:`;
    } else if (rem.kind === 'reg_start') {
      text =
        `🔔 Регистрация открыта!\n\n` +
        `🏆 Олимпиада: «${rem.oly_title}»\n` +
        `Регистрация на этап «${rem.stage_name}» уже началась. Успей подать заявку!`;
    } else if (rem.kind === 'reg_3d') {
      text =
        `⏳ До окончания регистрации осталось 3 дня!\n\n` +
        `🏆 Олимпиада: «${rem.oly_title}»\n` +
        `Не упусти шанс получить льготу БВИ или 100 баллов!`;
    } else if (rem.kind === 'reg_1d') {
      text =
        `🚨 Последний день регистрации!\n\n` +
        `🏆 Олимпиада: «${rem.oly_title}»\n` +
        `Регистрация на «${rem.stage_name}» закрывается сегодня! Подай заявку прямо сейчас:`;
    } else if (rem.kind === 'stage_1d') {
      text =
        `📝 Завтра начинается тур олимпиады!\n\n` +
        `🏆 «${rem.oly_title}»\n` +
        `Этап: ${rem.stage_name}\nПроверь доступ в личный кабинет и подготовь черновики!`;
    } else {
      text =
        `⏰ Напоминание по олимпиаде «${rem.oly_title}»:\n` +
        `Этап: ${rem.stage_name}`;
    }

    const kb = keyboards.reminderButtons(rem.subscription_id, rem.oly_url);

    // Если настроен Telegram бот, пробуем отправить через Telegram
    if (config.telegramToken) {
      const { sendTelegramReminder } = await import('../bot/telegram.js');
      const tgSuccess = await sendTelegramReminder(rem.max_user_id, text, { attachments: [kb] });
      if (tgSuccess) {
        return true;
      }
    }

    // Если токен тестовый или мы в симуляции, логируем отправку
    if (config.botToken === 'mock_token' || config.botToken.startsWith('test_')) {
      console.log(`\n📨 [Эмуляция отправки сообщения] -> Пользователь: ${rem.max_user_id}`);
      console.log(`Текст: ${text}`);
      console.log(`Кнопки прикреплены к сообщению.`);
      return true;
    }

    try {
      await this.botApi.sendMessageToUser(rem.max_user_id, text, {
        attachments: [kb],
      });
      return true;
    } catch (err: any) {
      console.error(`Ошибка MAX Bot API при отправке пользователю ${rem.max_user_id}:`, err.message);
      return false;
    }
  }
}
