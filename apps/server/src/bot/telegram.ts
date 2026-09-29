import { Bot as TgBot, InlineKeyboard } from 'grammy';
import { Database } from '../db/index.js';
import { config } from '../config.js';
import {
  handleStartCommand,
  handleMenuCommand,
  handleMyCommand,
  handleSettingsCommand,
  handleDeleteCommand,
  handleCallbackQuery,
  BotContextLike,
} from './handlers.js';

let tgBotInstance: TgBot | null = null;

function isValidTelegramUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    // Telegram API отклоняет localhost и 127.0.0.1 в inline-кнопках (ошибка Wrong HTTP URL)
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return false;
    if (!parsed.hostname.includes('.') && !parsed.hostname.includes(':')) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Преобразование кнопок формата MAX Bot API в нативные кнопки Telegram InlineKeyboard
 */
function convertMaxButtonsToTelegram(extra?: any, userId?: string): any {
  if (!extra?.attachments) return undefined;

  const inlineKeyboard = new InlineKeyboard();

  for (const att of extra.attachments) {
    if (att.payload?.buttons) {
      for (const row of att.payload.buttons) {
        for (const btn of row) {
          if (btn.type === 'callback') {
            inlineKeyboard.text(btn.text, btn.payload);
          } else if (btn.type === 'link') {
            if (isValidTelegramUrl(btn.url)) {
              inlineKeyboard.url(btn.text, btn.url);
            } else {
              inlineKeyboard.text(btn.text, `link_info:${btn.url}`);
            }
          } else if (btn.type === 'open_app') {
            const baseUrl = config.miniappUrl || `http://localhost:${config.port}/app`;
            const separator = baseUrl.includes('?') ? '&' : '?';
            const targetUrl = userId ? `${baseUrl}${separator}user_id=${encodeURIComponent(userId)}` : baseUrl;
            if (targetUrl.startsWith('https://') && isValidTelegramUrl(targetUrl)) {
              inlineKeyboard.webApp(btn.text, targetUrl);
            } else if (isValidTelegramUrl(targetUrl)) {
              inlineKeyboard.url(btn.text, targetUrl);
            } else {
              // В локальном режиме без публичного домена (localhost) делаем callback, чтобы Telegram не выдавал Wrong HTTP URL
              inlineKeyboard.text(btn.text, 'open_app_info');
            }
          }
        }
        inlineKeyboard.row();
      }
    }
  }

  return { reply_markup: inlineKeyboard };
}

function adaptTelegramContext(ctx: any): BotContextLike {
  const userId = String(ctx.from?.id || ctx.chat?.id || '');
  return {
    user: {
      id: userId,
      username: ctx.from?.username,
      first_name: ctx.from?.first_name,
    },
    chatId: userId,
    startPayload: ctx.match || undefined,
    callback: ctx.callbackQuery?.data
      ? { callback_id: ctx.callbackQuery.id, payload: ctx.callbackQuery.data }
      : undefined,
    async reply(text: string, extra?: any) {
      const tgExtra = convertMaxButtonsToTelegram(extra, userId);
      return ctx.reply(text, tgExtra);
    },
    async editMessageText(text: string, extra?: any) {
      const tgExtra = convertMaxButtonsToTelegram(extra, userId);
      if (ctx.editMessageText) {
        try {
          return await ctx.editMessageText(text, tgExtra);
        } catch (e: any) {
          if (e.message?.includes('message is not modified')) {
            return;
          }
          console.warn('Telegram editMessageText error, fallback to reply:', e.message);
        }
      }
      return ctx.reply(text, tgExtra);
    },
    async answerOnCallback(extra?: any) {
      if (ctx.answerCallbackQuery) {
        return ctx.answerCallbackQuery(extra?.notification ? { text: extra.notification } : undefined);
      }
    },
  };
}

export function setupTelegramBot(db: Database): TgBot | null {
  if (!config.telegramToken) {
    return null;
  }

  const bot = new TgBot(config.telegramToken);
  tgBotInstance = bot;

  bot.catch((err) => {
    console.error('❌ Ошибка Telegram бота:', err.message || err);
  });

  // Установка меню быстрых команд слева в строке ввода в Telegram
  bot.api
    .setMyCommands([
      { command: 'app', description: '🚀 Открыть каталог в Mini App' },
      { command: 'menu', description: '📋 Главное меню бота' },
      { command: 'my', description: '📅 Мои олимпиады и дедлайны' },
      { command: 'settings', description: '⚙️ Настройки профиля' },
      { command: 'delete', description: '🗑 Удалить все мои данные' },
      { command: 'start', description: '🔄 Начать сначала / перезапустить' },
    ])
    .then(() => {
      console.log('✅ Меню команд Telegram бота успешно установлено в интерфейсе');
    })
    .catch((err) => {
      console.warn('⚠️ Не удалось установить меню команд Telegram:', err.message);
    });

  let lastRegisteredMenuUrl = '';
  const updateMenuButton = async () => {
    const currentUrl = config.miniappUrl;
    if (currentUrl && currentUrl.startsWith('https://') && currentUrl !== lastRegisteredMenuUrl) {
      try {
        await bot.api.setChatMenuButton({
          menu_button: {
            type: 'web_app',
            text: '🏆 Mini App',
            web_app: { url: currentUrl },
          },
        });
        lastRegisteredMenuUrl = currentUrl;
        console.log(`✅ Telegram Chat Menu Button синхронизирована: ${currentUrl}`);
      } catch (err: any) {
        console.warn('⚠️ Не удалось установить кнопку меню Telegram:', err.message);
      }
    }
  };

  updateMenuButton();
  const menuInterval = setInterval(updateMenuButton, 15000);
  if (menuInterval.unref) menuInterval.unref();

  const handleAppCommand = async (ctx: any) => {
    const userId = String(ctx.from?.id || ctx.chat?.id || '');
    const baseUrl = config.miniappUrl || `http://localhost:${config.port}/app`;
    const separator = baseUrl.includes('?') ? '&' : '?';
    const targetUrl = userId ? `${baseUrl}${separator}user_id=${encodeURIComponent(userId)}` : baseUrl;

    const keyboard = new InlineKeyboard();
    if (targetUrl.startsWith('https://') && isValidTelegramUrl(targetUrl)) {
      keyboard.webApp('🚀 Открыть каталог в Mini App', targetUrl);
    } else {
      keyboard.url('🚀 Открыть каталог в Mini App', targetUrl);
    }

    await ctx.reply(
      '🏆 Олимпиадный навигатор — Mini App\n\n' +
      'Нажми кнопку ниже, чтобы открыть интерактивный каталог, персональную подборку и управление дедлайнами прямо внутри Telegram:',
      { reply_markup: keyboard }
    );
  };

  bot.command('app', handleAppCommand);
  bot.command('catalog', handleAppCommand);

  bot.command('start', async (ctx) => {
    const adapted = adaptTelegramContext(ctx);
    await handleStartCommand(adapted, db);
  });

  bot.command('menu', async (ctx) => {
    const adapted = adaptTelegramContext(ctx);
    await handleMenuCommand(adapted, db);
  });

  bot.command('my', async (ctx) => {
    const adapted = adaptTelegramContext(ctx);
    await handleMyCommand(adapted, db);
  });

  bot.command('settings', async (ctx) => {
    const adapted = adaptTelegramContext(ctx);
    await handleSettingsCommand(adapted, db);
  });

  bot.command('delete', async (ctx) => {
    const adapted = adaptTelegramContext(ctx);
    await handleDeleteCommand(adapted, db);
  });

  bot.on('callback_query:data', async (ctx) => {
    const adapted = adaptTelegramContext(ctx);
    await handleCallbackQuery(adapted, db);
  });

  return bot;
}

/**
 * Отправка напоминания через Telegram
 */
export async function sendTelegramReminder(
  chatId: string,
  text: string,
  extraButtons: any
): Promise<boolean> {
  if (!tgBotInstance) return false;
  try {
    const tgExtra = convertMaxButtonsToTelegram(extraButtons);
    await tgBotInstance.api.sendMessage(chatId, text, tgExtra);
    return true;
  } catch (err: any) {
    console.error(`Ошибка отправки напоминания в Telegram (${chatId}):`, err.message);
    return false;
  }
}
