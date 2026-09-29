import type { Bot } from '@maxhub/max-bot-api';
import { Database } from '../db/index.js';
import { keyboards } from './keyboards.js';
import { createMaxBot } from './maxClient.js';
import {
  handleStartCommand,
  handleMenuCommand,
  handleMyCommand,
  handleSettingsCommand,
  handleDeleteCommand,
  handleCallbackQuery,
} from './handlers.js';

export function setupBot(db: Database): Bot {
  const bot = createMaxBot();

  // Централизованная обработка ошибок: ошибка не роняет процесс!
  bot.catch((err: any) => {
    console.error('❌ Ошибка при обработке события MAX Bot API:', err?.message || err);
  });

  // Регистрация команд бота в меню MAX
  bot.api
    .setMyCommands([
      { name: 'app', description: '🚀 Открыть каталог в Mini App' },
      { name: 'menu', description: '📋 Главное меню' },
      { name: 'my', description: '📅 Мои олимпиады и дедлайны' },
      { name: 'settings', description: '⚙️ Настройки профиля' },
      { name: 'delete', description: '🗑 Удалить все мои данные' },
      { name: 'start', description: '🔄 Начать сначала' },
    ])
    .catch(() => {
      // Игнорируем если токен ещё не активен в MAX API
    });

  // Команда /start
  bot.command('start', async (ctx) => {
    try {
      await handleStartCommand(ctx as any, db);
    } catch (e: any) {
      console.error('Ошибка в /start:', e.message);
      await ctx.reply('Произошла ошибка при загрузке. Нажмите /start для повторной попытки.').catch(() => {});
    }
  });

  // Событие bot_started (когда пользователь начинает диалог или переходит по ссылке)
  bot.on('bot_started', async (ctx) => {
    try {
      await handleStartCommand(ctx as any, db);
    } catch (e: any) {
      console.error('Ошибка в bot_started:', e.message);
    }
  });

  // Команда /menu
  bot.command('menu', async (ctx) => {
    try {
      await handleMenuCommand(ctx as any, db);
    } catch (e: any) {
      console.error('Ошибка в /menu:', e.message);
    }
  });

  // Команда /app и /catalog (Mini App в MAX)
  bot.command('app', async (ctx) => {
    try {
      await ctx.reply('🏆 Олимпиадный навигатор — Mini App:\nНажмите кнопку ниже, чтобы открыть интерактивный каталог:', {
        attachments: [keyboards.mainMenu()],
      });
    } catch (e: any) {
      console.error('Ошибка в /app:', e.message);
    }
  });

  bot.command('catalog', async (ctx) => {
    try {
      await ctx.reply('🏆 Олимпиадный навигатор — Mini App:\nНажмите кнопку ниже, чтобы открыть интерактивный каталог:', {
        attachments: [keyboards.mainMenu()],
      });
    } catch (e: any) {
      console.error('Ошибка в /catalog:', e.message);
    }
  });

  // Команда /my (мои дедлайны)
  bot.command('my', async (ctx) => {
    try {
      await handleMyCommand(ctx as any, db);
    } catch (e: any) {
      console.error('Ошибка в /my:', e.message);
    }
  });

  // Команда /settings
  bot.command('settings', async (ctx) => {
    try {
      await handleSettingsCommand(ctx as any, db);
    } catch (e: any) {
      console.error('Ошибка в /settings:', e.message);
    }
  });

  // Команда /delete
  bot.command('delete', async (ctx) => {
    try {
      await handleDeleteCommand(ctx as any, db);
    } catch (e: any) {
      console.error('Ошибка в /delete:', e.message);
    }
  });

  // Обработка нажатий на инлайн-кнопки (message_callback)
  bot.on('message_callback', async (ctx) => {
    try {
      const adapted = {
        ...ctx,
        reply: (text: string, extra?: any) => ctx.reply(text, extra),
        editMessageText: async (text: string, extra?: any) => {
          if ((ctx as any).editMessage) {
            return (ctx as any).editMessage({ body: { text, ...extra } });
          }
          return ctx.reply(text, extra);
        },
      };
      await handleCallbackQuery(adapted as any, db);
    } catch (e: any) {
      console.error('Ошибка при обработке callback:', e.message);
    }
  });

  return bot;
}
