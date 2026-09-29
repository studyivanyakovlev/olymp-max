import type { Bot } from '@maxhub/max-bot-api';
import { Database } from '../db/index.js';
import { keyboards, setMiniAppBot } from './keyboards.js';
import { createMaxBot } from './maxClient.js';
import { isDemoToken } from '../config.js';
import {
  handleStartCommand,
  handleMenuCommand,
  handleMyCommand,
  handleSettingsCommand,
  handleDeleteCommand,
  handleCallbackQuery,
  BotContextLike,
} from './handlers.js';

function adaptMaxContext(ctx: any): BotContextLike {
  const rawUser = ctx.user ?? ctx.update?.callback?.user ?? ctx.update?.user;
  const rawCallback = ctx.callback ?? ctx.update?.callback;
  const userId = String(rawUser?.user_id ?? rawUser?.id ?? ctx.chatId ?? '');
  const messageId = ctx.messageId ?? ctx.update?.message?.body?.mid ?? ctx.update?.message_id;

  const adapted: BotContextLike = {
    user: {
      id: userId,
      username: rawUser?.username ?? undefined,
      first_name: rawUser?.first_name ?? undefined,
    },
    chatId: ctx.chatId ?? userId,
    messageId,
    startPayload: ctx.startPayload,
    callback: rawCallback
      ? {
          callback_id: rawCallback.callback_id,
          payload: rawCallback.payload,
          message_id: messageId,
        }
      : undefined,
    async reply(text: string, extra?: any) {
      if (ctx.chatId) {
        try {
          return await ctx.reply(text, extra);
        } catch (e: any) {
          console.warn('ctx.reply(chatId) error, trying sendMessageToUser:', e.message);
        }
      }
      const numUserId = Number(rawUser?.user_id ?? rawUser?.id ?? userId);
      if (numUserId && ctx.api?.sendMessageToUser) {
        return await ctx.api.sendMessageToUser(numUserId, text, extra);
      }
      return ctx.reply(text, extra);
    },
    async editMessageText(text: string, extra?: any) {
      if (messageId && ctx.api?.editMessage) {
        try {
          return await ctx.api.editMessage(messageId, { text, ...extra });
        } catch (e: any) {
          console.warn('MAX api.editMessage error, fallback to reply:', e.message);
        }
      } else if (ctx.editMessage) {
        try {
          return await ctx.editMessage({ text, ...extra });
        } catch (e: any) {
          console.warn('MAX ctx.editMessage error, fallback to reply:', e.message);
        }
      }
      return adapted.reply(text, extra);
    },
    async answerOnCallback(extra?: any) {
      const cbId = rawCallback?.callback_id;
      const payload = extra?.message
        ? { message: extra.message }
        : { notification: extra?.notification || 'OK' };
      if (cbId && ctx.api?.answerOnCallback) {
        try {
          return await ctx.api.answerOnCallback(cbId, payload);
        } catch (e: any) {
          console.warn('MAX answerOnCallback error:', e?.message || e);
        }
      } else if (ctx.answerOnCallback && rawCallback) {
        try {
          return await ctx.answerOnCallback(payload);
        } catch {
          // Игнорируем ошибку ответа на callback если он уже закрыт
        }
      }
    },
  };

  return adapted;
}

export function setupBot(db: Database): Bot {
  const bot = createMaxBot();

  // Централизованная обработка ошибок: ошибка не роняет процесс!
  bot.catch((err: any) => {
    console.error('❌ Ошибка при обработке события MAX Bot API:', err?.message || err);
  });

  // Ник бота нужен кнопкам open_app, чтобы MAX открыл именно наше мини-приложение
  if (!isDemoToken()) {
    bot.api
      .getMyInfo()
      .then((info) => {
        setMiniAppBot(info);
        console.log(`✓ [MAX Бот] @${info.username ?? info.user_id}: кнопки Mini App привязаны к боту`);
      })
      .catch((err: any) => {
        console.warn('⚠️ [MAX Бот] Не удалось получить GET /me, для кнопок Mini App используется BOT_USERNAME:', err.message);
      });
  }

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
      await handleStartCommand(adaptMaxContext(ctx), db);
    } catch (e: any) {
      console.error('Ошибка в /start:', e.message);
      await ctx.reply('Произошла ошибка при загрузке. Нажмите /start для повторной попытки.').catch(() => {});
    }
  });

  // Событие bot_started (когда пользователь начинает диалог или переходит по ссылке)
  bot.on('bot_started', async (ctx) => {
    try {
      await handleStartCommand(adaptMaxContext(ctx), db);
    } catch (e: any) {
      console.error('Ошибка в bot_started:', e.message);
    }
  });

  // Команда /menu
  bot.command('menu', async (ctx) => {
    try {
      await handleMenuCommand(adaptMaxContext(ctx), db);
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
      await handleMyCommand(adaptMaxContext(ctx), db);
    } catch (e: any) {
      console.error('Ошибка в /my:', e.message);
    }
  });

  // Команда /settings
  bot.command('settings', async (ctx) => {
    try {
      await handleSettingsCommand(adaptMaxContext(ctx), db);
    } catch (e: any) {
      console.error('Ошибка в /settings:', e.message);
    }
  });

  // Команда /delete
  bot.command('delete', async (ctx) => {
    try {
      await handleDeleteCommand(adaptMaxContext(ctx), db);
    } catch (e: any) {
      console.error('Ошибка в /delete:', e.message);
    }
  });

  // Обработка нажатий на инлайн-кнопки (message_callback)
  bot.on('message_callback', async (ctx) => {
    try {
      const adapted = adaptMaxContext(ctx);
      console.log(`[MAX Callback] от пользователя ${adapted.user?.id}: payload="${adapted.callback?.payload}"`);
      await handleCallbackQuery(adapted, db);
    } catch (e: any) {
      console.error('Ошибка при обработке callback:', e.message);
    }
  });

  return bot;
}
