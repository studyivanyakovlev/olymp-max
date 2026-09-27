import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Database } from '../db/index.js';
import { verifyAndParseInitData } from '../domain/security.js';
import { generateRemindersForSubscription, handleReminderAction } from '../domain/reminders.js';
import { getRecommendationsForUser } from '../domain/recommendations.js';
import {
  handleStartCommand,
  handleMenuCommand,
  handleMyCommand,
  handleSettingsCommand,
  handleDeleteCommand,
  handleCallbackQuery,
} from '../bot/handlers.js';
import { ReminderScheduler } from '../scheduler/index.js';
import {
  UpdateProfileInputSchema,
  CreateSubscriptionInputSchema,
  UpdateSubscriptionStatusSchema,
} from '@olymp-max/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Извлечение пользователя из заголовков запроса
async function authenticateUser(req: FastifyRequest, reply: FastifyReply, db: Database): Promise<any> {
  const initDataHeader = req.headers['x-init-data'] as string | undefined;
  const mockUserHeader =
    (req.headers['x-user-id'] as string | undefined) ||
    ((req.query as any)?.user_id as string | undefined);

  let maxUserId: string | null = null;

  if (initDataHeader) {
    try {
      const parsed = verifyAndParseInitData(initDataHeader);
      maxUserId = String(parsed.user.id);
    } catch (err: any) {
      if (mockUserHeader) {
        maxUserId = mockUserHeader;
      } else if (process.env.NODE_ENV !== 'production') {
        maxUserId = '1';
      } else {
        reply.code(401).send({ error: 'Unauthorized', message: err.message });
        return null;
      }
    }
  } else if (mockUserHeader) {
    maxUserId = mockUserHeader;
  } else if (process.env.NODE_ENV !== 'production') {
    maxUserId = '1';
  } else {
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'Требуется заголовок x-init-data с подписью MAX Bridge (или x-user-id в dev-режиме)',
    });
    return null;
  }

  // Получаем или создаем пользователя в БД
  let userRes = await db.query('SELECT * FROM users WHERE max_user_id = $1', [maxUserId]);
  if (userRes.rowCount === 0) {
    userRes = await db.query(
      `INSERT INTO users (max_user_id, timezone, quiet_from, quiet_to)
       VALUES ($1, 'Europe/Moscow', '22:00', '08:00')
       RETURNING *`,
      [maxUserId]
    );
  }
  return userRes.rows[0];
}

export function registerApiRoutes(fastify: FastifyInstance, db: Database) {
  // --- HEALTH CHECK ---
  fastify.get('/api/health', async () => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: db.isPGlite ? 'pglite-embedded' : 'postgresql',
    };
  });

  // --- GET /api/olympiads (Каталог с фильтрами) ---
  fastify.get('/api/olympiads', async (req: FastifyRequest<{
    Querystring: {
      subject?: string;
      grade?: string;
      level?: string;
      format?: string;
      search?: string;
    };
  }>) => {
    const { subject, grade, level, search } = req.query;

    let sql = `
      SELECT o.id, o.title, o.organizer, o.rsosh_level, o.subjects, o.grade_from, o.grade_to,
             o.benefits_note, o.url, o.source_url, o.verified_at, o.is_demo
      FROM olympiads o
      WHERE 1=1
    `;
    const params: any[] = [];

    if (grade) {
      params.push(parseInt(grade, 10));
      sql += ` AND o.grade_from <= $${params.length} AND o.grade_to >= $${params.length}`;
    }

    if (level) {
      const lvl = parseInt(level, 10);
      params.push(lvl);
      sql += ` AND o.rsosh_level = $${params.length}`;
    }

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      sql += ` AND (LOWER(o.title) LIKE $${params.length} OR LOWER(o.organizer) LIKE $${params.length})`;
    }

    sql += ` ORDER BY o.is_demo DESC, o.rsosh_level ASC NULLS LAST, o.title ASC`;

    const res = await db.query(sql, params);

    // Дополнительная фильтрация по предмету в jsonb массиве
    let rows = res.rows.map(r => ({
      ...r,
      subjects: typeof r.subjects === 'string' ? JSON.parse(r.subjects) : r.subjects,
    }));

    if (subject) {
      rows = rows.filter(r => r.subjects.includes(subject));
    }

    return rows;
  });

  // --- GET /api/olympiads/:id (Карточка олимпиады с этапами) ---
  fastify.get('/api/olympiads/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const { id } = req.params;
    const olyRes = await db.query('SELECT * FROM olympiads WHERE id = $1', [id]);
    if (olyRes.rowCount === 0) {
      return reply.code(404).send({ error: 'Not Found', message: 'Олимпиада не найдена' });
    }

    const stagesRes = await db.query(
      'SELECT id, kind, name, starts_at, ends_at, region_code, format FROM stages WHERE olympiad_id = $1 ORDER BY starts_at ASC',
      [id]
    );

    const olympiad = olyRes.rows[0];
    return {
      ...olympiad,
      subjects: typeof olympiad.subjects === 'string' ? JSON.parse(olympiad.subjects) : olympiad.subjects,
      stages: stagesRes.rows,
    };
  });

  // --- GET /api/me (Профиль пользователя) ---
  fastify.get('/api/me', async (req, reply) => {
    const user = await authenticateUser(req, reply, db);
    if (!user) return;

    const subjectsRes = await db.query(
      'SELECT subject_code FROM user_subjects WHERE user_id = $1',
      [user.id]
    );

    return {
      id: user.id,
      max_user_id: user.max_user_id,
      grade: user.grade,
      region_code: user.region_code,
      timezone: user.timezone,
      quiet_from: user.quiet_from,
      quiet_to: user.quiet_to,
      consent_at: user.consent_at,
      subjects: subjectsRes.rows.map(r => r.subject_code),
    };
  });

  // --- PUT /api/me (Обновление профиля) ---
  fastify.put('/api/me', async (req, reply) => {
    const user = await authenticateUser(req, reply, db);
    if (!user) return;

    const parseResult = UpdateProfileInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Validation Error', issues: parseResult.error.issues });
    }
    const data = parseResult.data;

    // Обновляем основные поля
    await db.query(
      `UPDATE users SET
         grade = COALESCE($1, grade),
         region_code = COALESCE($2, region_code),
         timezone = COALESCE($3, timezone),
         quiet_from = COALESCE($4, quiet_from),
         quiet_to = COALESCE($5, quiet_to),
         updated_at = NOW()
       WHERE id = $6`,
      [data.grade, data.region_code, data.timezone, data.quiet_from, data.quiet_to, user.id]
    );

    // Обновляем предметы, если переданы
    if (data.subjects) {
      await db.query('DELETE FROM user_subjects WHERE user_id = $1', [user.id]);
      for (const s of data.subjects) {
        await db.query(
          'INSERT INTO user_subjects (user_id, subject_code) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [user.id, s]
        );
      }
    }

    return { status: 'success', message: 'Профиль успешно обновлен' };
  });

  // --- DELETE /api/me (Удалить все данные) ---
  fastify.delete('/api/me', async (req, reply) => {
    const user = await authenticateUser(req, reply, db);
    if (!user) return;

    await db.query('DELETE FROM users WHERE id = $1', [user.id]);
    return { status: 'success', message: 'Все данные пользователя удалены' };
  });

  // --- GET /api/me/subscriptions (Мои олимпиады и ближайшие дедлайны) ---
  fastify.get('/api/me/subscriptions', async (req, reply) => {
    const user = await authenticateUser(req, reply, db);
    if (!user) return;

    const subsRes = await db.query(
      `SELECT s.id, s.user_id, s.olympiad_id, s.status, s.created_at, s.updated_at,
              o.title, o.organizer, o.rsosh_level, o.url, o.benefits_note, o.is_demo,
              (
                SELECT json_build_object(
                  'stage_id', st.id,
                  'stage_name', st.name,
                  'kind', r.kind,
                  'date', r.send_at
                )
                FROM reminders r
                JOIN stages st ON st.id = r.stage_id
                WHERE r.subscription_id = s.id AND r.status = 'pending'
                ORDER BY r.send_at ASC
                LIMIT 1
              ) as next_deadline
       FROM subscriptions s
       JOIN olympiads o ON o.id = s.olympiad_id
       WHERE s.user_id = $1 AND s.status != 'dropped'
       ORDER BY s.created_at DESC`,
      [user.id]
    );

    return subsRes.rows.map(row => ({
      id: row.id,
      user_id: row.user_id,
      olympiad_id: row.olympiad_id,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      title: row.title,
      organizer: row.organizer,
      rsosh_level: row.rsosh_level,
      url: row.url,
      benefits_note: row.benefits_note,
      is_demo: row.is_demo,
      next_deadline: row.next_deadline,
    }));
  });

  // --- POST /api/me/subscriptions (Подписаться на олимпиаду) ---
  fastify.post('/api/me/subscriptions', async (req, reply) => {
    const user = await authenticateUser(req, reply, db);
    if (!user) return;

    const parseResult = CreateSubscriptionInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Validation Error', issues: parseResult.error.issues });
    }
    const { olympiad_id } = parseResult.data;

    // Проверяем существование олимпиады
    const olyRes = await db.query('SELECT id, is_demo FROM olympiads WHERE id = $1', [olympiad_id]);
    if (olyRes.rowCount === 0) {
      return reply.code(404).send({ error: 'Not Found', message: 'Олимпиада не найдена' });
    }

    const subRes = await db.query(
      `INSERT INTO subscriptions (user_id, olympiad_id, status)
       VALUES ($1, $2, 'interested')
       ON CONFLICT (user_id, olympiad_id) DO UPDATE SET status = 'interested', updated_at = NOW()
       RETURNING id`,
      [user.id, olympiad_id]
    );
    const subId = subRes.rows[0].id;

    // Генерируем напоминания
    const remCount = await generateRemindersForSubscription(db, subId, olympiad_id, user.id);

    return {
      status: 'success',
      subscription_id: subId,
      reminders_created: remCount,
      is_demo: olyRes.rows[0].is_demo,
    };
  });

  // --- PATCH /api/me/subscriptions/:id (Сменить статус подписки) ---
  fastify.patch('/api/me/subscriptions/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const user = await authenticateUser(req, reply, db);
    if (!user) return;

    const subId = parseInt(req.params.id, 10);
    const parseResult = UpdateSubscriptionStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Validation Error', issues: parseResult.error.issues });
    }

    const { status } = parseResult.data;

    if (status === 'registered') {
      const res = await handleReminderAction(db, subId, 'registered');
      return { status: 'success', message: res.message };
    } else if (status === 'dropped') {
      const res = await handleReminderAction(db, subId, 'drop');
      return { status: 'success', message: res.message };
    } else {
      await db.query('UPDATE subscriptions SET status = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3', [
        status,
        subId,
        user.id,
      ]);
      return { status: 'success', message: `Статус изменен на ${status}` };
    }
  });

  // --- GET /api/recommendations (Персональная подборка олимпиад) ---
  fastify.get('/api/recommendations', async (req, reply) => {
    const user = await authenticateUser(req, reply, db);
    if (!user) return;
    const list = await getRecommendationsForUser(db, user.id, 10);
    return list;
  });

  // --- МИНИ-ПРИЛОЖЕНИЕ (MINI APP: КАТАЛОГ, ПОДБОРКА, ДЕДЛАЙНЫ, ПРОФИЛЬ) ---
  const serveAppHtml = async (req: FastifyRequest, reply: FastifyReply) => {
    const candidates = [
      path.resolve(__dirname, 'app.html'),
      path.resolve(__dirname, '../src/api/app.html'),
      path.resolve(process.cwd(), 'apps/server/src/api/app.html'),
      path.resolve(process.cwd(), 'src/api/app.html'),
    ];
    for (const htmlPath of candidates) {
      if (fs.existsSync(htmlPath)) {
        const html = fs.readFileSync(htmlPath, 'utf-8');
        return reply.type('text/html').send(html);
      }
    }
    return reply.code(404).send({ error: 'app.html not found' });
  };

  fastify.get('/app', serveAppHtml);
  fastify.get('/', async (req, reply) => {
    return reply.redirect('/app');
  });

  // --- ИНТЕРАКТИВНЫЙ ВЕБ-ПЛЕЙГРАУНД ДЛЯ ТЕСТИРОВАНИЯ ---
  fastify.get('/playground', async (req, reply) => {
    const candidates = [
      path.resolve(__dirname, 'playground.html'),
      path.resolve(__dirname, '../src/api/playground.html'),
      path.resolve(process.cwd(), 'apps/server/src/api/playground.html'),
      path.resolve(process.cwd(), 'src/api/playground.html'),
    ];
    for (const htmlPath of candidates) {
      if (fs.existsSync(htmlPath)) {
        const html = fs.readFileSync(htmlPath, 'utf-8');
        return reply.type('text/html').send(html);
      }
    }
    return reply.code(404).send({ error: 'playground.html not found' });
  });

  // --- ЭНДПОИНТ ТЕСТОВОГО ВЗАИМОДЕЙСТВИЯ (КОМАНДЫ И КНОПКИ) ---
  fastify.post('/api/test/interact', async (req: FastifyRequest<{
    Body: { userId: string; action: 'command' | 'callback'; value: string };
  }>) => {
    const { userId, action, value } = req.body;
    const messages: Array<{ text: string; attachments: any[]; isEdit?: boolean }> = [];

    const ctx = {
      user: { id: userId, username: 'playground_user' },
      chatId: userId,
      callback: action === 'callback' ? { callback_id: 'play_cb', payload: value } : undefined,
      async reply(text: string, extra?: any) {
        messages.push({ text, attachments: extra?.attachments || [], isEdit: false });
      },
      async editMessageText(text: string, extra?: any) {
        messages.push({ text, attachments: extra?.attachments || [], isEdit: true });
      },
      async answerOnCallback() {},
    };

    if (action === 'command') {
      if (value === '/start') {
        await handleStartCommand(ctx as any, db);
      } else if (value === '/menu') {
        await handleMenuCommand(ctx as any, db);
      } else if (value === '/my') {
        await handleMyCommand(ctx as any, db);
      } else if (value === '/settings') {
        await handleSettingsCommand(ctx as any, db);
      } else if (value === '/delete') {
        await handleDeleteCommand(ctx as any, db);
      } else if (value === '/tick') {
        await db.query("UPDATE reminders SET send_at = NOW() - INTERVAL '1 second' WHERE status = 'pending'");
        const scheduler = new ReminderScheduler(db);
        const count = await scheduler.tick();
        messages.push({
          text: `⏱️ [Планировщик] Проверил очередь. Отправлено напоминаний: ${count}. Загляните в консоль сервера или нажмите /my!`,
          attachments: [],
        });
      } else {
        await handleMenuCommand(ctx as any, db);
      }
    } else if (action === 'callback') {
      await handleCallbackQuery(ctx as any, db);
    }

    return { messages };
  });
}
