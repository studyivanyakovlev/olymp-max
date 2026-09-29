import { getDb } from './db/index.js';
import { setupBot } from './bot/index.js';
import { ReminderScheduler } from './scheduler/index.js';
import { createServer } from './api/server.js';
import { config, isDemoToken, webhookSecret } from './config.js';

async function bootstrap() {
  console.log('==================================================');
  console.log('🚀 Запуск сервиса «Олимпиадный навигатор»');
  console.log(`   Режим: ${config.isDev ? 'DEVELOPMENT' : 'PRODUCTION'}`);
  console.log(`   Режим бота: ${config.botMode.toUpperCase()}`);
  console.log(`   Демо-режим жюри: ${config.demoMode ? 'ВКЛЮЧЕН' : 'ВЫКЛЮЧЕН'}`);
  console.log('==================================================');

  // 1. Инициализация базы данных и схемы
  const db = await getDb();

  // Автоматический импорт датасетов, если база пуста
  try {
    const checkRes = await db.query('SELECT COUNT(*) as count FROM olympiads');
    const olyCount = parseInt(checkRes.rows[0]?.count || '0', 10);
    if (olyCount === 0) {
      console.log('ℹ️ В базе данных 0 олимпиад. Автоматический импорт датасетов (seed)...');
      const { runSeed } = await import('./db/seed.js');
      await runSeed(db);
    } else {
      console.log(`✓ В базе данных загружено олимпиад: ${olyCount}`);
    }
  } catch (err: any) {
    console.warn('⚠️ Ошибка проверки/автоимпорта датасетов:', err.message);
  }

  // 2. Инициализация чат-бота MAX
  const bot = setupBot(db);

  // 3. Запуск фонового планировщика напоминаний
  const scheduler = new ReminderScheduler(db, bot.api);
  scheduler.start(60 * 1000); // проверка каждую минуту

  // 4. Запуск HTTP REST API (Fastify)
  const server = await createServer(db, bot);

  // HOST=127.0.0.1 — когда сервер стоит за nginx и наружу его открывать не нужно
  await server.listen({ port: config.port, host: process.env.HOST || '0.0.0.0' });
  console.log(`✓ HTTP REST API доступен по адресу: http://localhost:${config.port}`);
  console.log(`✓ OpenAPI Swagger документация:    http://localhost:${config.port}/docs`);
  console.log(`✓ Проверка работоспособности:       http://localhost:${config.port}/api/health`);

  // 5. Запуск получения обновлений бота
  if (config.botMode === 'polling') {
    if (isDemoToken()) {
      console.log(`ℹ️ [Бот] Запущен с тестовым токеном. Используйте npm run simulator для проверки работы бота локально.`);
    } else {
      console.log(`✓ [MAX Бот] Запуск polling для получения обновлений от MAX...`);
      bot.start({ mode: 'polling' }).catch((err: any) => {
        console.error('Ошибка polling MAX бота:', err.message);
      });
    }
  } else if (isDemoToken()) {
    console.log(`ℹ️ [Бот] Режим Webhook с тестовым токеном: подписка в MAX не создаётся.`);
  } else {
    // Регистрируем вебхук в MAX: POST /subscriptions с секретом, прочие подписки снимаем
    const webhookUrl = `${config.publicUrl.replace(/\/$/, '')}/webhook`;
    try {
      bot.botInfo ??= await bot.api.getMyInfo();
      const subscriptions = await bot.api.getSubscriptions();
      await Promise.all(
        subscriptions.filter((s) => s.url !== webhookUrl).map((s) => bot.api.unsubscribe(s.url))
      );
      await bot.api.subscribe(webhookUrl, webhookSecret());
      console.log(`✓ [MAX Бот] Вебхук зарегистрирован: ${webhookUrl}`);
    } catch (err: any) {
      console.error(`Не удалось зарегистрировать вебхук MAX (${webhookUrl}):`, err.message);
    }
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nОстановка сервисов...');
    scheduler.stop();
    await server.close();
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('Критическая ошибка запуска приложения:', err);
  process.exit(1);
});
