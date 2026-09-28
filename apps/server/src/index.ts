import { getDb } from './db/index.js';
import { setupBot } from './bot/index.js';
import { setupTelegramBot } from './bot/telegram.js';
import { ReminderScheduler } from './scheduler/index.js';
import { createServer } from './api/server.js';
import { config } from './config.js';

async function bootstrap() {
  console.log('==================================================');
  console.log('🚀 Запуск сервиса «Олимпиадный навигатор в MAX»');
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

  await server.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`✓ HTTP REST API доступен по адресу: http://localhost:${config.port}`);
  console.log(`✓ OpenAPI Swagger документация:    http://localhost:${config.port}/docs`);
  console.log(`✓ Проверка работоспособности:       http://localhost:${config.port}/api/health`);

  // 5. Запуск получения обновлений бота
  if (config.botMode === 'polling') {
    if (config.botToken === 'mock_token' || config.botToken.startsWith('test_')) {
      console.log(`ℹ️ [Бот] Запущен с тестовым токеном. Используйте npm run simulator для проверки работы бота локально.`);
    } else {
      console.log(`✓ [Бот] Запущен long-polling для получения обновлений от MAX...`);
      bot.startPolling().catch((err: any) => {
        console.error('Ошибка long polling бота:', err.message);
      });
    }
  } else {
    console.log(`✓ [MAX Бот] Работает в режиме Webhook на эндпоинте: ${config.publicUrl}/webhook`);
  }

  // 6. Запуск Telegram бота (если указан TELEGRAM_BOT_TOKEN)
  const tgBot = setupTelegramBot(db);
  if (tgBot) {
    console.log(`✓ [Telegram] Бот подключен и запускает polling...`);
    tgBot.start().catch((err: any) => {
      console.error('Ошибка Telegram бота:', err.message);
    });
  } else {
    console.log(`ℹ️ [Telegram] Токен не указан (TELEGRAM_BOT_TOKEN). Для тестирования в Telegram укажите его в .env`);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nОстановка сервисов...');
    scheduler.stop();
    if (tgBot) tgBot.stop();
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
