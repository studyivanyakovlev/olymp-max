import { Database } from '../db/index.js';
import { keyboards, getSubjectTitle, getRegionTitle } from './keyboards.js';
import { getRecommendationsForUser } from '../domain/recommendations.js';
import { generateRemindersForSubscription, handleReminderAction } from '../domain/reminders.js';
import { config } from '../config.js';

export interface BotContextLike {
  user?: { id: string | number; username?: string; first_name?: string };
  chatId?: string | number;
  messageId?: string | number;
  startPayload?: string;
  callback?: { callback_id: string; payload?: string; message_id?: string | number };
  reply(text: string, extra?: any): Promise<any>;
  editMessageText?(text: string, extra?: any): Promise<any>;
  answerOnCallback?(extra?: any): Promise<any>;
}

// Получение или создание пользователя в базе данных
export async function getOrCreateUser(db: Database, maxUserId: string | number): Promise<any> {
  const strId = String(maxUserId);
  let res = await db.query('SELECT * FROM users WHERE max_user_id = $1', [strId]);
  if (res.rowCount === 0) {
    res = await db.query(
      `INSERT INTO users (max_user_id, timezone, quiet_from, quiet_to)
       VALUES ($1, 'Europe/Moscow', '22:00', '08:00')
       RETURNING *`,
      [strId]
    );
  }
  return res.rows[0];
}

export async function handleStartCommand(ctx: BotContextLike, db: Database) {
  const maxUserId = ctx.user?.id || ctx.chatId;
  if (!maxUserId) return;

  const user = await getOrCreateUser(db, maxUserId);

  // Фиксируем событие перехода
  await db.query(
    `INSERT INTO events (user_id, name, props) VALUES ($1, 'bot_started', $2)`,
    [user.id, JSON.stringify({ start_payload: ctx.startPayload || null })]
  );

  // Сохраняем шаг диалога
  await db.query(
    `INSERT INTO dialog_state (user_id, step, data, updated_at)
     VALUES ($1, 'onboarding_grade', '{}'::jsonb, NOW())
     ON CONFLICT (user_id) DO UPDATE SET step = 'onboarding_grade', updated_at = NOW()`,
    [user.id]
  );

  const welcomeText =
    `👋 Привет! Я — Олимпиадный навигатор в MAX.\n\n` +
    `Моя цель — не дать тебе пропустить регистрацию на олимпиады из Перечня РСОШ и этапы ВсОШ, которые дают БВИ или 100 баллов ЕГЭ.\n\n` +
    `🔒 О приватности: мы храним только твой класс, предметы и регион. Никаких ФИО и телефонов. Удалить данные можно в любой момент командой /delete.\n\n` +
    `Давай настроим твою персональную подборку за 3 шага:\n` +
    `1️⃣ В каком ты классе?`;

  await ctx.reply(welcomeText, {
    attachments: [keyboards.gradeKeyboard()],
  });
}

export async function handleMenuCommand(ctx: BotContextLike, db: Database, editInsteadOfReply = false) {
  const maxUserId = ctx.user?.id || ctx.chatId;
  if (!maxUserId) return;
  const user = await getOrCreateUser(db, maxUserId);

  const menuText =
    `📋 Главное меню\n\n` +
    `Выбирай раздел:\n` +
    `• 🎯 Персональная подборка — олимпиады под твой профиль\n` +
    `• 📅 Мои дедлайны — отслеживание твоих регистраций и туров\n` +
    `• 🚀 Mini App — полный интерактивный каталог\n` +
    `• ⚙️ Настройки — класс, предметы, тихие часы`;

  const extra = { attachments: [keyboards.mainMenu()] };
  if (editInsteadOfReply && ctx.editMessageText) {
    await ctx.editMessageText(menuText, extra);
  } else {
    await ctx.reply(menuText, extra);
  }
}

export async function handleMyCommand(ctx: BotContextLike, db: Database) {
  const maxUserId = ctx.user?.id || ctx.chatId;
  if (!maxUserId) return;
  const user = await getOrCreateUser(db, maxUserId);

  const subsRes = await db.query(
    `SELECT s.id as sub_id, s.status, o.id as oly_id, o.title, o.url,
            (SELECT MIN(r.send_at) FROM reminders r WHERE r.subscription_id = s.id AND r.status = 'pending') as next_reminder
     FROM subscriptions s
     JOIN olympiads o ON o.id = s.olympiad_id
     WHERE s.user_id = $1 AND s.status != 'dropped'
     ORDER BY s.created_at DESC`,
    [user.id]
  );

  if (subsRes.rowCount === 0) {
    await ctx.reply(
      `У тебя пока нет активных подписок на олимпиады.\n\n` +
      `Посмотри персональную подборку, чтобы не пропустить регистрацию!`,
      { attachments: [keyboards.mainMenu()] }
    );
    return;
  }

  let text = `📅 Твои олимпиады и ближайшие дедлайны:\n\n`;
  for (const row of subsRes.rows) {
    const statusIcon = row.status === 'registered' ? '✅ Зарегистрирован' : '⏳ В планах';
    const nextDate = row.next_reminder
      ? new Date(row.next_reminder).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
      : 'дедлайны скоро появятся';

    text += `🏆 ${row.title}\n`;
    text += `   • Статус: ${statusIcon}\n`;
    text += `   • Ближайшее напоминание: ${nextDate}\n\n`;
  }

  await ctx.reply(text, {
    attachments: [keyboards.mainMenu()],
  });
}

export async function handleDeleteCommand(ctx: BotContextLike, db: Database) {
  await ctx.reply(
    `⚠️ Удаление профиля и данных\n\n` +
    `Команда /delete полностью удалит твой профиль, выбранные предметы, подписки и расписание напоминаний.\n\n` +
    `Ты уверен, что хочешь всё удалить?`,
    { attachments: [keyboards.deleteConfirmation()] }
  );
}

export async function handleSettingsCommand(ctx: BotContextLike, db: Database, editInsteadOfReply = false) {
  const maxUserId = ctx.user?.id || ctx.chatId;
  if (!maxUserId) return;
  const user = await getOrCreateUser(db, maxUserId);

  const subRes = await db.query(
    'SELECT subject_code FROM user_subjects WHERE user_id = $1',
    [user.id]
  );
  const subjects = subRes.rows.length > 0
    ? subRes.rows.map(r => getSubjectTitle(r.subject_code)).join(', ')
    : 'не выбраны';

  const regionTitle = getRegionTitle(user.region_code);
  const quietHoursStr = (user.quiet_from === user.quiet_to || (!user.quiet_from && !user.quiet_to))
    ? 'отключены (круглосуточно)'
    : `с ${user.quiet_from} до ${user.quiet_to}`;

  const settingsText =
    `⚙️ Настройки твоего профиля:\n\n` +
    `• 🎓 Класс: ${user.grade ? `${user.grade}-й класс` : 'не указан'}\n` +
    `• 📚 Предметы: ${subjects}\n` +
    `• 📍 Регион: ${regionTitle}\n` +
    `• ⏰ Тихие часы (без уведомлений): ${quietHoursStr}\n\n` +
    `Выбери параметр, который хочешь изменить:`;

  const extra = {
    attachments: [keyboards.settingsMenu()],
  };

  if (editInsteadOfReply && ctx.editMessageText) {
    await ctx.editMessageText(settingsText, extra);
  } else {
    await ctx.reply(settingsText, extra);
  }
}

export async function handleCallbackQuery(ctx: BotContextLike, db: Database) {
  const payload = ctx.callback?.payload;
  const maxUserId = ctx.user?.id || ctx.chatId;
  if (!maxUserId || !payload) return;

  const user = await getOrCreateUser(db, maxUserId);

  // Ответ на callback для снятия крутилки в клиенте MAX
  if (ctx.answerOnCallback) {
    try {
      await ctx.answerOnCallback({ notification: 'Обработано' });
    } catch {
      // Игнорируем ошибку ответа на callback если он уже закрыт
    }
  }

  // --- ШАГ 1: ВЫБОР КЛАССА ---
  if (payload.startsWith('grade:')) {
    const grade = parseInt(payload.split(':')[1], 10);
    await db.query('UPDATE users SET grade = $1, updated_at = NOW() WHERE id = $2', [grade, user.id]);
    await db.query(
      `INSERT INTO dialog_state (user_id, step, data, updated_at)
       VALUES ($1, 'onboarding_subjects', '{"selected_subjects":[]}'::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET step = 'onboarding_subjects', updated_at = NOW()`,
      [user.id]
    );

    const step2Text =
      `Класс: ${grade}-й 👍\n\n` +
      `2️⃣ Шаг 2: Выбери предметы, которые тебя интересуют (можно выбрать несколько):`;
    const step2Extra = { attachments: [keyboards.subjectsKeyboard([])] };

    if (ctx.editMessageText) {
      await ctx.editMessageText(step2Text, step2Extra);
    } else {
      await ctx.reply(step2Text, step2Extra);
    }
    return;
  }

  // --- ШАГ 2: ВЫБОР ПРЕДМЕТОВ (МУЛЬТИВЫБОР В ОДНОМ СООБЩЕНИИ) ---
  if (payload.startsWith('sub_toggle:')) {
    const subject = payload.split(':')[1];
    const stateRes = await db.query('SELECT data FROM dialog_state WHERE user_id = $1', [user.id]);
    let selected: string[] = stateRes.rows[0]?.data?.selected_subjects || [];

    if (selected.includes(subject)) {
      selected = selected.filter(s => s !== subject);
    } else {
      selected.push(subject);
    }

    await db.query(
      `UPDATE dialog_state SET data = $1, updated_at = NOW() WHERE user_id = $2`,
      [JSON.stringify({ selected_subjects: selected }), user.id]
    );

    // Обновляем клавиатуру с выбранными галочками В ТОМ ЖЕ СООБЩЕНИИ
    const toggleText = `2️⃣ Шаг 2: Выбери предметы (выбрано: ${selected.length}). Отмечай нужные и нажимай «Готово»:`;
    const toggleExtra = { attachments: [keyboards.subjectsKeyboard(selected)] };

    if (ctx.editMessageText) {
      await ctx.editMessageText(toggleText, toggleExtra);
    } else {
      await ctx.reply(toggleText, toggleExtra);
    }
    return;
  }

  if (payload === 'subjects_done') {
    const stateRes = await db.query('SELECT data FROM dialog_state WHERE user_id = $1', [user.id]);
    const selected: string[] = stateRes.rows[0]?.data?.selected_subjects || [];

    // Сохраняем в таблицу user_subjects
    await db.query('DELETE FROM user_subjects WHERE user_id = $1', [user.id]);
    for (const s of selected) {
      await db.query(
        'INSERT INTO user_subjects (user_id, subject_code) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [user.id, s]
      );
    }

    await db.query(
      `UPDATE dialog_state SET step = 'onboarding_region', updated_at = NOW() WHERE user_id = $1`,
      [user.id]
    );

    const step3Text =
      `Предметы сохранены! 📚\n\n` +
      `3️⃣ Шаг 3: Укажи свой регион (для отслеживания этапов ВсОШ и площадок):`;
    const step3Extra = { attachments: [keyboards.regionsKeyboard()] };

    if (ctx.editMessageText) {
      await ctx.editMessageText(step3Text, step3Extra);
    } else {
      await ctx.reply(step3Text, step3Extra);
    }
    return;
  }

  // --- ШАГ 3: ВЫБОР РЕГИОНА И ФИНИШ ОНБОРДИНГА ---
  if (payload.startsWith('region:')) {
    const regionCode = payload.split(':')[1];
    await db.query(
      `UPDATE users SET region_code = $1, consent_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [regionCode === 'all' ? null : regionCode, user.id]
    );

    await db.query(
      `UPDATE dialog_state SET step = 'ready', updated_at = NOW() WHERE user_id = $1`,
      [user.id]
    );

    const finishText =
      `🎉 Отлично! Настройка завершена.\n\n` +
      `Вот твоя персональная подборка топовых олимпиад на сезон 2026/27:`;

    if (ctx.editMessageText) {
      await ctx.editMessageText(finishText);
    } else {
      await ctx.reply(finishText);
    }

    // Показываем подборку олимпиад
    await sendRecommendationsList(ctx, db, user.id);
    return;
  }

  // --- ПОДПИСКА НА ОЛИМПИАДУ ---
  if (payload.startsWith('sub:')) {
    const olympiadId = payload.split(':')[1];

    // Создаём или обновляем запись подписки
    const subRes = await db.query(
      `INSERT INTO subscriptions (user_id, olympiad_id, status)
       VALUES ($1, $2, 'interested')
       ON CONFLICT (user_id, olympiad_id) DO UPDATE SET status = 'interested', updated_at = NOW()
       RETURNING id`,
      [user.id, olympiadId]
    );
    const subId = subRes.rows[0].id;

    // Генерируем напоминания
    const remCount = await generateRemindersForSubscription(db, subId, olympiadId, user.id);

    const olyRes = await db.query('SELECT title, is_demo FROM olympiads WHERE id = $1', [olympiadId]);
    const olyTitle = olyRes.rows[0]?.title || 'олимпиаду';
    const isDemo = olyRes.rows[0]?.is_demo;

    // Фиксируем метрику
    await db.query(
      `INSERT INTO events (user_id, name, props) VALUES ($1, 'subscribed', $2)`,
      [user.id, JSON.stringify({ olympiad_id: olympiadId, subscription_id: subId, is_demo: isDemo })]
    );

    let replyMsg = `🔔 Подписал на «${olyTitle}»! Создано напоминаний: ${remCount}.`;
    if (isDemo) {
      replyMsg += `\n\n⚡ Это демо-олимпиада для жюри: первое напоминание придёт ровно через 1 минуту!`;
    }

    await ctx.reply(replyMsg, {
      attachments: [keyboards.mainMenu()],
    });
    return;
  }

  // --- ОТПИСКА ОТ ОЛИМПИАДЫ ---
  if (payload.startsWith('unsub:')) {
    const olympiadId = payload.split(':')[1];
    const subRes = await db.query(
      `SELECT id FROM subscriptions WHERE user_id = $1 AND olympiad_id = $2`,
      [user.id, olympiadId]
    );
    if (subRes.rowCount > 0) {
      await handleReminderAction(db, subRes.rows[0].id, 'drop');
    }
    await ctx.reply(`Подписка отменена.`, { attachments: [keyboards.mainMenu()] });
    return;
  }

  // --- ДЕЙСТВИЯ ИЗ НАПОМИНАНИЙ ---
  if (payload.startsWith('act:')) {
    const parts = payload.split(':');
    const action = parts[1] as 'registered' | 'remind_tomorrow' | 'drop';
    const subscriptionId = parseInt(parts[2], 10);

    const result = await handleReminderAction(db, subscriptionId, action);
    await ctx.reply(result.message, {
      attachments: [keyboards.mainMenu()],
    });
    return;
  }

  // --- РАЗДЕЛ НАСТРОЕК: ИЗМЕНЕНИЕ ПАРАМЕТРОВ ---
  if (payload === 'set_menu:grade') {
    const text = '🎓 Выбери свой класс:';
    const extra = { attachments: [keyboards.gradeSettingsKeyboard()] };
    if (ctx.editMessageText) {
      await ctx.editMessageText(text, extra);
    } else {
      await ctx.reply(text, extra);
    }
    return;
  }

  if (payload.startsWith('set_grade:')) {
    const grade = parseInt(payload.split(':')[1], 10);
    await db.query('UPDATE users SET grade = $1, updated_at = NOW() WHERE id = $2', [grade, user.id]);
    await handleSettingsCommand(ctx, db, true);
    return;
  }

  if (payload === 'set_menu:subjects') {
    const subRes = await db.query('SELECT subject_code FROM user_subjects WHERE user_id = $1', [user.id]);
    const currentSubs: string[] = subRes.rows.map(r => r.subject_code);
    await db.query(
      `INSERT INTO dialog_state (user_id, step, data, updated_at)
       VALUES ($1, 'settings_subjects', $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET step = 'settings_subjects', data = $2, updated_at = NOW()`,
      [user.id, JSON.stringify({ selected_subjects: currentSubs })]
    );

    const text = `📚 Выбери предметы (выбрано: ${currentSubs.length}). Отметь нужные и нажми «Сохранить изменения»:`;
    const extra = { attachments: [keyboards.subjectsSettingsKeyboard(currentSubs)] };
    if (ctx.editMessageText) {
      await ctx.editMessageText(text, extra);
    } else {
      await ctx.reply(text, extra);
    }
    return;
  }

  if (payload.startsWith('set_sub_toggle:')) {
    const subject = payload.split(':')[1];
    const stateRes = await db.query('SELECT data FROM dialog_state WHERE user_id = $1', [user.id]);
    let selected: string[] = stateRes.rows[0]?.data?.selected_subjects || [];

    if (selected.includes(subject)) {
      selected = selected.filter(s => s !== subject);
    } else {
      selected.push(subject);
    }

    await db.query(
      `UPDATE dialog_state SET data = $1, updated_at = NOW() WHERE user_id = $2`,
      [JSON.stringify({ selected_subjects: selected }), user.id]
    );

    const text = `📚 Выбери предметы (выбрано: ${selected.length}). Отметь нужные и нажми «Сохранить изменения»:`;
    const extra = { attachments: [keyboards.subjectsSettingsKeyboard(selected)] };
    if (ctx.editMessageText) {
      await ctx.editMessageText(text, extra);
    } else {
      await ctx.reply(text, extra);
    }
    return;
  }

  if (payload === 'set_subjects_done') {
    const stateRes = await db.query('SELECT data FROM dialog_state WHERE user_id = $1', [user.id]);
    const selected: string[] = stateRes.rows[0]?.data?.selected_subjects || [];

    await db.query('DELETE FROM user_subjects WHERE user_id = $1', [user.id]);
    for (const s of selected) {
      await db.query(
        'INSERT INTO user_subjects (user_id, subject_code) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [user.id, s]
      );
    }

    await handleSettingsCommand(ctx, db, true);
    return;
  }

  if (payload === 'set_menu:region') {
    const text = '📍 Выбери свой регион:';
    const extra = { attachments: [keyboards.regionSettingsKeyboard()] };
    if (ctx.editMessageText) {
      await ctx.editMessageText(text, extra);
    } else {
      await ctx.reply(text, extra);
    }
    return;
  }

  if (payload.startsWith('set_region:')) {
    const regionCode = payload.split(':')[1];
    await db.query(
      'UPDATE users SET region_code = $1, updated_at = NOW() WHERE id = $2',
      [regionCode === 'all' ? null : regionCode, user.id]
    );
    await handleSettingsCommand(ctx, db, true);
    return;
  }

  if (payload === 'set_menu:quiet') {
    const text =
      `⏰ Настройка тихих часов:\n\n` +
      `В указанный период бот не отправляет ночные уведомления и переносит их на утреннее время:`;
    const extra = { attachments: [keyboards.quietHoursKeyboard()] };
    if (ctx.editMessageText) {
      await ctx.editMessageText(text, extra);
    } else {
      await ctx.reply(text, extra);
    }
    return;
  }

  if (payload.startsWith('set_quiet:')) {
    const val = payload.replace('set_quiet:', '');
    if (val === 'none') {
      await db.query(
        `UPDATE users SET quiet_from = '00:00', quiet_to = '00:00', updated_at = NOW() WHERE id = $1`,
        [user.id]
      );
    } else {
      const parts = val.split(':');
      const qFrom = `${parts[0]}:${parts[1]}`;
      const qTo = `${parts[2]}:${parts[3]}`;
      await db.query(
        `UPDATE users SET quiet_from = $1, quiet_to = $2, updated_at = NOW() WHERE id = $3`,
        [qFrom, qTo, user.id]
      );
    }
    await handleSettingsCommand(ctx, db, true);
    return;
  }

  // --- НАВИГАЦИЯ ПО МЕНЮ ---
  if (payload === 'menu:recommendations') {
    await sendRecommendationsList(ctx, db, user.id);
    return;
  }

  if (payload === 'menu:deadlines') {
    await handleMyCommand(ctx, db);
    return;
  }

  if (payload === 'menu:settings') {
    await handleSettingsCommand(ctx, db, true);
    return;
  }

  if (payload === 'menu:main') {
    await handleMenuCommand(ctx, db, true);
    return;
  }

  // --- ИНФОРМАЦИЯ О MINI APP ---
  if (payload === 'open_app_info' || payload.startsWith('open_app:')) {
    const url = `http://localhost:${config.port}/app?user_id=${user.max_user_id}`;
    await ctx.reply(
      `🚀 Клиентский Mini App (Каталог и личный кабинет):\n\n` +
      `🔗 Открой ссылку в браузере:\n${url}\n\n` +
      `💡 Твой профиль, выбранные предметы и подписки загрузятся автоматически!`,
      { attachments: [keyboards.mainMenu()] }
    );
    return;
  }

  // --- ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ ДАННЫХ ---
  if (payload === 'confirm_delete') {
    await db.query('DELETE FROM users WHERE id = $1', [user.id]);
    await ctx.reply('🗑 Все твои персональные данные и подписки успешно удалены. До встречи!');
    return;
  }

  // Неизвестная кнопка
  await ctx.reply('Команда получена.', { attachments: [keyboards.mainMenu()] });
}

async function sendRecommendationsList(ctx: BotContextLike, db: Database, userId: number) {
  const list = await getRecommendationsForUser(db, userId, 6);

  if (list.length === 0) {
    await ctx.reply('Пока нет доступных олимпиад по твоим фильтрам. Попробуй изменить класс или предметы в настройках.', {
      attachments: [keyboards.mainMenu()],
    });
    return;
  }

  for (const item of list) {
    const levelStr = item.rsosh_level ? `Уровень РСОШ: ${item.rsosh_level}` : 'ВсОШ / Гос. перечень';
    const demoBadge = item.is_demo ? '⚡ [ДЕМО ДЛЯ ЖЮРИ] ' : '';
    const text =
      `${demoBadge}🏆 ${item.title}\n` +
      `🏢 Организатор: ${item.organizer}\n` +
      `🎓 ${levelStr} | Классы: ${item.grade_from}–${item.grade_to}\n` +
      `🎁 Льгота: ${item.benefits_note || 'БВИ / 100 баллов'}`;

    // Проверяем, подписан ли уже
    const subCheck = await db.query(
      'SELECT id FROM subscriptions WHERE user_id = $1 AND olympiad_id = $2 AND status != \'dropped\'',
      [userId, item.id]
    );
    const isSub = subCheck.rowCount > 0;

    await ctx.reply(text, {
      attachments: [keyboards.olympiadCard(item.id, item.url, isSub)],
    });
  }
}
