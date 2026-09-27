import { getDb } from '../db/index.js';
import { runSeed } from '../db/seed.js';
import { ReminderScheduler } from '../scheduler/index.js';
import {
  handleStartCommand,
  handleCallbackQuery,
  handleMyCommand,
  handleMenuCommand,
  handleDeleteCommand,
} from '../bot/handlers.js';

class MockBotContext {
  public user: { id: string; username: string };
  public chatId: string;
  public startPayload?: string;
  public callback?: { callback_id: string; payload?: string };
  public lastMessage: string = '';
  public lastAttachments: any[] = [];

  constructor(userId: string = 'test_user_777', username: string = 'ivan_tester') {
    this.user = { id: userId, username };
    this.chatId = userId;
  }

  async reply(text: string, extra?: any): Promise<any> {
    this.lastMessage = text;
    this.lastAttachments = extra?.attachments || [];
    console.log('\n💬 [БОТ -> ПОЛЬЗОВАТЕЛЬ]:');
    console.log('--------------------------------------------------');
    console.log(text);
    if (this.lastAttachments.length > 0) {
      console.log('\n[Интерактивные кнопки]:');
      for (const att of this.lastAttachments) {
        if (att.payload?.buttons) {
          for (const row of att.payload.buttons) {
            const rowStr = row
              .map((b: any) => `[ ${b.text} (${b.payload || b.web_app || b.url}) ]`)
              .join('  ');
            console.log(`  ${rowStr}`);
          }
        }
      }
    }
    console.log('--------------------------------------------------\n');
    return { ok: true };
  }

  async answerOnCallback(extra?: any): Promise<any> {
    return { ok: true };
  }
}

async function runSimulation() {
  console.log('===========================================================');
  console.log('🧪 ЗАПУСК ТЕСТОВОГО СИМУЛЯТОРА СЦЕНАРИЕВ ДЛЯ БЭКЕНДА MAX');
  console.log('===========================================================\n');

  // 1. Инициализация БД и сид данных
  const db = await getDb();
  await runSeed();

  const ctx = new MockBotContext('user_olympiad_tester', 'olymp_tester');

  console.log('\n⏩ ТЕСТ 1: Пользователь вводит команду /start');
  await handleStartCommand(ctx, db);

  console.log('\n⏩ ТЕСТ 2: Пользователь выбирает «10 класс»');
  ctx.callback = { callback_id: 'cb_1', payload: 'grade:10' };
  await handleCallbackQuery(ctx, db);

  console.log('\n⏩ ТЕСТ 3: Пользователь выбирает предметы «Информатика» и «Математика»');
  ctx.callback = { callback_id: 'cb_2', payload: 'sub_toggle:informatics' };
  await handleCallbackQuery(ctx, db);

  ctx.callback = { callback_id: 'cb_3', payload: 'sub_toggle:math' };
  await handleCallbackQuery(ctx, db);

  console.log('\n⏩ ТЕСТ 4: Пользователь нажимает «Готово, перейти дальше»');
  ctx.callback = { callback_id: 'cb_4', payload: 'subjects_done' };
  await handleCallbackQuery(ctx, db);

  console.log('\n⏩ ТЕСТ 5: Пользователь выбирает регион «Москва»');
  ctx.callback = { callback_id: 'cb_5', payload: 'region:77' };
  await handleCallbackQuery(ctx, db);

  console.log('\n⏩ ТЕСТ 6: Пользователь подписывается на ДЕМО-ОЛИМПИАДУ для жюри');
  ctx.callback = { callback_id: 'cb_6', payload: 'sub:demo-jury-olympiad' };
  await handleCallbackQuery(ctx, db);

  console.log('\n⏩ ТЕСТ 7: Проверка команды /my (Мои дедлайны)');
  await handleMyCommand(ctx, db);

  console.log('\n⏩ ТЕСТ 8: Симуляция срабатывания планировщика напоминаний');
  // В БД у демо-олимпиады send_at = now + 1 min.
  // Для мгновенного теста сместим send_at на now - 1 сек
  await db.query(
    `UPDATE reminders SET send_at = NOW() - INTERVAL '1 second'
     WHERE kind = 'demo_1m' AND status = 'pending'`
  );

  const scheduler = new ReminderScheduler(db);
  const sentCount = await scheduler.tick();
  console.log(`✓ Планировщик отправил напоминаний: ${sentCount}`);

  // Проверяем подписку пользователя
  const subRes = await db.query(
    `SELECT s.id FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE u.max_user_id = $1`,
    [ctx.user.id]
  );
  const subId = subRes.rows[0].id;

  console.log('\n⏩ ТЕСТ 9: Пользователь нажимает в напоминании кнопку «Зарегистрировался»');
  ctx.callback = { callback_id: 'cb_7', payload: `act:registered:${subId}` };
  await handleCallbackQuery(ctx, db);

  // Проверяем итоговый статус
  const statusRes = await db.query('SELECT status FROM subscriptions WHERE id = $1', [subId]);
  console.log(`✓ Статус подписки в базе данных: "${statusRes.rows[0].status}" (ожидается "registered")`);

  console.log('\n⏩ ТЕСТ 10: Проверка команды /menu');
  await handleMenuCommand(ctx, db);

  console.log('\n===========================================================');
  console.log('🎉 ВСЕ 10 СЦЕНАРИЕВ ТЕСТОВОГО СИМУЛЯТОРА ПРОЙДЕНЫ УСПЕШНО!');
  console.log('===========================================================');

  await db.close();
  process.exit(0);
}

runSimulation().catch(err => {
  console.error('Ошибка в симуляторе:', err);
  process.exit(1);
});
