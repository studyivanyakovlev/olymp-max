import readline from 'readline';
import { getDb } from '../db/index.js';
import { runSeed } from '../db/seed.js';
import { ReminderScheduler } from '../scheduler/index.js';
import {
  handleStartCommand,
  handleMenuCommand,
  handleMyCommand,
  handleSettingsCommand,
  handleDeleteCommand,
  handleCallbackQuery,
} from '../bot/handlers.js';

interface ButtonChoice {
  text: string;
  payload?: string;
  url?: string;
}

class InteractiveUserSession {
  public db: any;
  public userId: string;
  public currentButtons: ButtonChoice[] = [];
  public scheduler: ReminderScheduler;

  constructor(db: any, userId: string = 'cli_user_' + Math.floor(Math.random() * 10000)) {
    this.db = db;
    this.userId = userId;
    this.scheduler = new ReminderScheduler(db);
  }

  createContext(callbackPayload?: string) {
    const that = this;
    return {
      user: { id: this.userId, username: 'interactive_tester' },
      chatId: this.userId,
      startPayload: undefined,
      callback: callbackPayload ? { callback_id: 'cli_cb', payload: callbackPayload } : undefined,
      async reply(text: string, extra?: any) {
        console.log('\n🤖 \x1b[36mОлимпиадный навигатор:\x1b[0m');
        console.log('────────────────────────────────────────────────────────────');
        console.log(text);

        // Сохраняем кнопки текущего сообщения
        that.currentButtons = [];
        if (extra?.attachments) {
          for (const att of extra.attachments) {
            if (att.payload?.buttons) {
              for (const row of att.payload.buttons) {
                for (const b of row) {
                  that.currentButtons.push({
                    text: b.text,
                    payload: b.payload || (b.web_app ? `open_app:${b.web_app}` : undefined),
                    url: b.url,
                  });
                }
              }
            }
          }
        }

        if (that.currentButtons.length > 0) {
          console.log('\n\x1b[33m[Выберите действие, введя номер кнопки в консоль]:\x1b[0m');
          that.currentButtons.forEach((b, idx) => {
            const extraInfo = b.url ? ` (Ссылка: ${b.url})` : '';
            console.log(`  \x1b[32m[${idx + 1}]\x1b[0m ${b.text}${extraInfo}`);
          });
        }
        console.log('────────────────────────────────────────────────────────────');
        return { ok: true };
      },
      async answerOnCallback() {
        return { ok: true };
      },
    };
  }

  async handleInput(input: string) {
    const trimmed = input.trim();
    if (!trimmed) return;

    // 1. Проверяем выбор по номеру кнопки
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= this.currentButtons.length) {
      const selected = this.currentButtons[num - 1];
      if (selected.url) {
        console.log(`\x1b[34mℹ️ Открыта внешняя ссылка:\x1b[0m ${selected.url}`);
        return;
      }
      if (selected.payload) {
        console.log(`\x1b[35m👆 Вы нажали кнопку [${num}]: "${selected.text}"\x1b[0m`);
        const ctx = this.createContext(selected.payload);
        await handleCallbackQuery(ctx, this.db);
        return;
      }
    }

    // 2. Обработка текстовых команд
    const ctx = this.createContext();

    if (trimmed === '/start') {
      console.log('⏩ Запуск команды /start');
      await handleStartCommand(ctx, this.db);
    } else if (trimmed === '/menu') {
      console.log('⏩ Главное меню /menu');
      await handleMenuCommand(ctx, this.db);
    } else if (trimmed === '/my') {
      console.log('⏩ Мои дедлайны /my');
      await handleMyCommand(ctx, this.db);
    } else if (trimmed === '/settings') {
      console.log('⏩ Настройки /settings');
      await handleSettingsCommand(ctx, this.db);
    } else if (trimmed === '/delete') {
      console.log('⏩ Удаление данных /delete');
      await handleDeleteCommand(ctx, this.db);
    } else if (trimmed === '/tick') {
      console.log('\x1b[33m⏱️ Принудительный такт планировщика напоминаний...\x1b[0m');
      // Сдвинем pending напоминания на сейчас для теста
      await this.db.query(
        `UPDATE reminders SET send_at = NOW() - INTERVAL '1 second' WHERE status = 'pending'`
      );
      const sent = await this.scheduler.tick();
      console.log(`✓ Отправлено напоминаний: ${sent}`);
    } else if (trimmed === '/help') {
      console.log('\nДоступные команды:');
      console.log('  /start    - Перезапустить онбординг с самого начала');
      console.log('  /menu     - Открыть главное меню');
      console.log('  /my       - Посмотреть подписки и дедлайны');
      console.log('  /settings - Настройки профиля');
      console.log('  /delete   - Удалить свои данные');
      console.log('  /tick     - Сэмулировать наступление времени напоминаний');
      console.log('  1, 2, 3.. - Нажать интерактивную кнопку по её номеру');
      console.log('  exit      - Выйти из симулятора\n');
    } else {
      console.log(`Неизвестный ввод: "${trimmed}". Введите номер кнопки или команду (/help).`);
    }
  }
}

async function startInteractiveCli() {
  console.clear();
  console.log('================================================================');
  console.log('💬 ИНТЕРАКТИВНЫЙ РЕЖИМ ТЕСТИРОВАНИЯ БОТА «ОЛИМПИАДНЫЙ НАВИГАТОР»');
  console.log('================================================================');
  console.log('Вы общаетесь с ботом в реальном времени.');
  console.log('Нажимайте кнопки, вводя их порядковый номер (1, 2, 3...),');
  console.log('или вводите команды: /start, /menu, /my, /tick, /help.');
  console.log('Для выхода напишите exit.\n');

  const db = await getDb();
  await runSeed();

  const session = new InteractiveUserSession(db);

  // Стартуем диалог
  await session.handleInput('/start');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promptUser = () => {
    rl.question('\x1b[1mВы > \x1b[0m', async (line) => {
      if (line.trim().toLowerCase() === 'exit') {
        console.log('Сессия завершена. До встречи!');
        rl.close();
        await db.close();
        process.exit(0);
      }
      await session.handleInput(line);
      promptUser();
    });
  };

  promptUser();
}

startInteractiveCli().catch((err) => {
  console.error('Ошибка в интерактивном режиме:', err);
  process.exit(1);
});
