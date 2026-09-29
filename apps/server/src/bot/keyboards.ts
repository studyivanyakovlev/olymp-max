import { Keyboard } from '@maxhub/max-bot-api';
import { config, isDemoToken } from '../config.js';

export const SUBJECT_OPTIONS = [
  { code: 'informatics', title: '💻 Информатика' },
  { code: 'math', title: '📐 Математика' },
  { code: 'physics', title: '⚡ Физика' },
  { code: 'chemistry', title: '🧪 Химия' },
  { code: 'biology', title: '🌿 Биология' },
  { code: 'literature', title: '📚 Литература' },
  { code: 'social_studies', title: '🏛 Обществознание' },
  { code: 'economics', title: '📈 Экономика' },
];

export const REGION_OPTIONS = [
  { code: '77', title: 'Москва' },
  { code: '78', title: 'Санкт-Петербург' },
  { code: '16', title: 'Республика Татарстан' },
  { code: '66', title: 'Свердловская область' },
  { code: 'all', title: 'Вся Россия / Другой' },
];

export function getSubjectTitle(code: string): string {
  const item = SUBJECT_OPTIONS.find(s => s.code === code);
  return item ? item.title : code;
}

export function getRegionTitle(code: string | null | undefined): string {
  if (!code || code === 'all') return 'Вся Россия / Другой';
  const item = REGION_OPTIONS.find(r => r.code === code);
  return item ? item.title : code;
}

// Кнопка open_app открывает мини-приложение бота: MAX ищет его по нику бота (web_app)
// или по ID бота (contact_id). Ник берём из GET /me при старте, BOT_USERNAME — запасной вариант.
// payload попадает в initData как start_param: по нему Mini App сразу открывает карточку олимпиады.
const miniAppBot: { username: string | null; userId: number | null } = {
  username: process.env.BOT_USERNAME || null,
  userId: null,
};

export function setMiniAppBot(info: { username?: string | null; user_id?: number | null }) {
  if (info.username) miniAppBot.username = info.username;
  if (info.user_id) miniAppBot.userId = info.user_id;
}

function openAppButton(text: string, startParam?: string) {
  if (miniAppBot.username) return Keyboard.button.openApp(text, miniAppBot.username, undefined, startParam);
  if (miniAppBot.userId || isDemoToken()) {
    return { type: 'open_app' as const, text, contact_id: miniAppBot.userId, payload: startParam ?? null };
  }
  // Бот ещё не знает свой ник: без кнопки сообщение всё равно отправится, а с неполной MAX его отклонит
  return null;
}

const compact = <T,>(row: Array<T | null>): T[] => row.filter((button): button is T => button !== null);

export const keyboards = {
  // Меню настроек
  settingsMenu() {
    return Keyboard.inlineKeyboard([
      [
        Keyboard.button.callback('🎓 Изменить класс', 'set_menu:grade'),
        Keyboard.button.callback('📚 Изменить предметы', 'set_menu:subjects'),
      ],
      [
        Keyboard.button.callback('📍 Изменить регион', 'set_menu:region'),
        Keyboard.button.callback('⏰ Тихие часы', 'set_menu:quiet'),
      ],
      [
        Keyboard.button.callback('🔙 Главное меню', 'menu:main'),
      ],
    ]);
  },

  // Выбор класса при онбординге
  gradeKeyboard() {
    return Keyboard.inlineKeyboard([
      [
        Keyboard.button.callback('8 класс', 'grade:8'),
        Keyboard.button.callback('9 класс', 'grade:9'),
      ],
      [
        Keyboard.button.callback('10 класс', 'grade:10'),
        Keyboard.button.callback('11 класс', 'grade:11'),
      ],
      [
        Keyboard.button.callback('🔙 Главное меню', 'menu:main'),
      ],
    ]);
  },

  // Выбор класса в настройках (с кнопкой назад)
  gradeSettingsKeyboard() {
    return Keyboard.inlineKeyboard([
      [
        Keyboard.button.callback('8 класс', 'set_grade:8'),
        Keyboard.button.callback('9 класс', 'set_grade:9'),
      ],
      [
        Keyboard.button.callback('10 класс', 'set_grade:10'),
        Keyboard.button.callback('11 класс', 'set_grade:11'),
      ],
      [
        Keyboard.button.callback('🔙 Назад в настройки', 'menu:settings'),
      ],
      [
        Keyboard.button.callback('🏠 Главное меню', 'menu:main'),
      ],
    ]);
  },

  // Выбор предметов (мультивыбор с галочками и кнопкой "Готово" при онбординге)
  subjectsKeyboard(selected: string[]) {
    const selectedSet = new Set(selected);
    const rows = [];
    for (let i = 0; i < SUBJECT_OPTIONS.length; i += 2) {
      const row = [];
      const item1 = SUBJECT_OPTIONS[i];
      const isSel1 = selectedSet.has(item1.code);
      row.push(
        Keyboard.button.callback(
          `${isSel1 ? '✅ ' : ''}${item1.title}`,
          `sub_toggle:${item1.code}`
        )
      );

      if (i + 1 < SUBJECT_OPTIONS.length) {
        const item2 = SUBJECT_OPTIONS[i + 1];
        const isSel2 = selectedSet.has(item2.code);
        row.push(
          Keyboard.button.callback(
            `${isSel2 ? '✅ ' : ''}${item2.title}`,
            `sub_toggle:${item2.code}`
          )
        );
      }
      rows.push(row);
    }

    rows.push([Keyboard.button.callback('➡️ Готово, перейти дальше', 'subjects_done')]);
    rows.push([Keyboard.button.callback('🔙 Главное меню', 'menu:main')]);
    return Keyboard.inlineKeyboard(rows);
  },

  // Выбор предметов в настройках (с кнопкой сохранения и возврата)
  subjectsSettingsKeyboard(selected: string[]) {
    const selectedSet = new Set(selected);
    const rows = [];
    for (let i = 0; i < SUBJECT_OPTIONS.length; i += 2) {
      const row = [];
      const item1 = SUBJECT_OPTIONS[i];
      const isSel1 = selectedSet.has(item1.code);
      row.push(
        Keyboard.button.callback(
          `${isSel1 ? '✅ ' : ''}${item1.title}`,
          `set_sub_toggle:${item1.code}`
        )
      );

      if (i + 1 < SUBJECT_OPTIONS.length) {
        const item2 = SUBJECT_OPTIONS[i + 1];
        const isSel2 = selectedSet.has(item2.code);
        row.push(
          Keyboard.button.callback(
            `${isSel2 ? '✅ ' : ''}${item2.title}`,
            `set_sub_toggle:${item2.code}`
          )
        );
      }
      rows.push(row);
    }

    rows.push([
      Keyboard.button.callback('💾 Сохранить изменения', 'set_subjects_done'),
    ]);
    rows.push([
      Keyboard.button.callback('🔙 Назад в настройки', 'menu:settings'),
      Keyboard.button.callback('🏠 Главное меню', 'menu:main'),
    ]);
    return Keyboard.inlineKeyboard(rows);
  },

  // Выбор региона при онбординге
  regionsKeyboard() {
    const rows: any[][] = REGION_OPTIONS.map(r => [
      Keyboard.button.callback(r.title, `region:${r.code}`),
    ]);
    rows.push([
      Keyboard.button.callback('🔙 Главное меню', 'menu:main'),
    ]);
    return Keyboard.inlineKeyboard(rows);
  },

  // Выбор региона в настройках (с кнопкой назад)
  regionSettingsKeyboard() {
    const rows: any[][] = REGION_OPTIONS.map(r => [
      Keyboard.button.callback(r.title, `set_region:${r.code}`),
    ]);
    rows.push([
      Keyboard.button.callback('🔙 Назад в настройки', 'menu:settings'),
      Keyboard.button.callback('🏠 Главное меню', 'menu:main'),
    ]);
    return Keyboard.inlineKeyboard(rows);
  },

  // Настройка тихих часов
  quietHoursKeyboard() {
    return Keyboard.inlineKeyboard([
      [
        Keyboard.button.callback('🌙 22:00 – 08:00', 'set_quiet:22:00:08:00'),
        Keyboard.button.callback('🌙 23:00 – 09:00', 'set_quiet:23:00:09:00'),
      ],
      [
        Keyboard.button.callback('🌙 21:00 – 09:00 (стандарт)', 'set_quiet:21:00:09:00'),
        Keyboard.button.callback('🔔 Круглосуточно (без ограничений)', 'set_quiet:none'),
      ],
      [
        Keyboard.button.callback('🔙 Назад в настройки', 'menu:settings'),
        Keyboard.button.callback('🏠 Главное меню', 'menu:main'),
      ],
    ]);
  },

  // Главное меню
  mainMenu() {
    return Keyboard.inlineKeyboard([
      [
        Keyboard.button.callback('🎯 Персональная подборка', 'menu:recommendations'),
        Keyboard.button.callback('📅 Мои дедлайны', 'menu:deadlines'),
      ],
      compact([
        openAppButton('🚀 Каталог в Mini App'),
        Keyboard.button.callback('⚙️ Настройки', 'menu:settings'),
      ]),
    ]);
  },

  // Кнопки для карточки олимпиады
  olympiadCard(olympiadId: string, url: string, isSubscribed: boolean = false) {
    const rows = [];
    if (!isSubscribed) {
      rows.push([
        Keyboard.button.callback('🔔 Подписаться на напоминания', `sub:${olympiadId}`),
      ]);
    } else {
      rows.push([
        Keyboard.button.callback('✅ Вы подписаны (отписаться)', `unsub:${olympiadId}`),
      ]);
    }

    rows.push(compact([
      Keyboard.button.link('🌐 Страница олимпиады', url),
      openAppButton('📱 Открыть в Mini App', olympiadId),
    ]));

    rows.push([
      Keyboard.button.callback('🏠 Главное меню', 'menu:main'),
    ]);

    return Keyboard.inlineKeyboard(rows);
  },

  // Кнопки в сообщении-напоминании
  reminderButtons(subscriptionId: number, url?: string) {
    const rows: any[][] = [
      [
        Keyboard.button.callback('✅ Зарегистрировался', `act:registered:${subscriptionId}`),
        Keyboard.button.callback('⏰ Напомнить завтра', `act:remind_tomorrow:${subscriptionId}`),
      ],
      [
        Keyboard.button.callback('❌ Не участвую', `act:drop:${subscriptionId}`),
      ],
      [
        Keyboard.button.callback('🏠 Главное меню', 'menu:main'),
      ],
    ];

    if (url) {
      rows[1].unshift(Keyboard.button.link('🌐 Перейти к регистрации', url));
    }

    return Keyboard.inlineKeyboard(rows);
  },

  // Кнопка возврата в меню
  backToMenu() {
    return Keyboard.inlineKeyboard([
      [Keyboard.button.callback('🔙 Главное меню', 'menu:main')],
    ]);
  },

  // Кнопка подтверждения удаления данных (/delete)
  deleteConfirmation() {
    return Keyboard.inlineKeyboard([
      [
        Keyboard.button.callback('🗑 Да, удалить все мои данные', 'confirm_delete'),
        Keyboard.button.callback('🔙 Главное меню (Отмена)', 'menu:main'),
      ],
    ]);
  },
};
