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

export const SUBJECT_TO_RUSSIAN: Record<string, string> = {
  informatics: 'Информатика',
  math: 'Математика',
  physics: 'Физика',
  chemistry: 'Химия',
  biology: 'Биология',
  literature: 'Литература',
  social_studies: 'Обществознание',
  economics: 'Экономика',
  russian: 'Русский язык',
  history: 'История',
  english: 'Английский язык',
};

export const RUSSIAN_TO_CODE: Record<string, string> = {
  'Информатика': 'informatics',
  'Математика': 'math',
  'Физика': 'physics',
  'Химия': 'chemistry',
  'Биология': 'biology',
  'Литература': 'literature',
  'Обществознание': 'social_studies',
  'Экономика': 'economics',
  'Русский язык': 'russian',
  'История': 'history',
  'Английский язык': 'english',
};

// Извлечение пользователя из заголовков запроса
async function authenticateUser(req: FastifyRequest, reply: FastifyReply, db: Database): Promise<any> {
  const initDataHeader = (
    req.headers['x-max-init-data'] ||
    req.headers['x-init-data']
  ) as string | undefined;

  const mockUserHeader =
    (req.headers['x-user-id'] as string | undefined) ||
    ((req.query as any)?.user_id as string | undefined);

  let maxUserId: string | null = null;

  if (initDataHeader && initDataHeader.trim() !== '') {
    try {
      const parsed = verifyAndParseInitData(initDataHeader);
      maxUserId = String(parsed.user.id);
    } catch (err: any) {
      if (mockUserHeader) {
        maxUserId = mockUserHeader;
      } else if (process.env.NODE_ENV !== 'production' || process.env.DEMO_MODE !== 'false') {
        maxUserId = '1';
      } else {
        reply.code(401).send({ error: 'Unauthorized', message: err.message });
        return null;
      }
    }
  }

  // Извлекаем пользователя из Telegram WebApp initData
  const tgInitHeader = req.headers['x-telegram-init-data'] as string | undefined;
  if (!maxUserId && tgInitHeader && tgInitHeader.trim() !== '') {
    try {
      const params = new URLSearchParams(tgInitHeader);
      const userStr = params.get('user');
      if (userStr) {
        const u = JSON.parse(userStr);
        if (u.id) maxUserId = String(u.id);
      }
    } catch {}
  }

  if (!maxUserId) {
    if (mockUserHeader) {
      maxUserId = mockUserHeader;
    } else if (process.env.NODE_ENV !== 'production' || process.env.DEMO_MODE !== 'false') {
      maxUserId = '1';
    } else {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Требуется заголовок X-Max-Init-Data / X-Telegram-Init-Data с подписью или идентификатор пользователя',
      });
      return null;
    }
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
    const { subject, grade, level, search, format } = req.query;

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

    const [olyRes, stagesRes] = await Promise.all([
      db.query(sql, params),
      db.query(
        'SELECT id, olympiad_id, kind, name, starts_at, ends_at, region_code, format FROM stages ORDER BY starts_at ASC'
      ),
    ]);

    const stagesByOly: Record<string, any[]> = {};
    for (const stage of stagesRes.rows) {
      if (!stagesByOly[stage.olympiad_id]) {
        stagesByOly[stage.olympiad_id] = [];
      }
      stagesByOly[stage.olympiad_id].push({
        ...stage,
        format: stage.format || 'online',
      });
    }

    let rows = olyRes.rows.map(r => {
      const rawSubs: string[] = typeof r.subjects === 'string' ? JSON.parse(r.subjects) : (r.subjects || []);
      const ruSubs = rawSubs.map(s => SUBJECT_TO_RUSSIAN[s] || s);
      const itemStages = stagesByOly[r.id] || [];
      const itemFormat = itemStages.find(s => s.format)?.format || 'online';

      return {
        ...r,
        subjects: ruSubs,
        raw_subjects: rawSubs,
        format: itemFormat,
        stages: itemStages,
      };
    });

    if (subject) {
      const targetCode = RUSSIAN_TO_CODE[subject] || subject;
      rows = rows.filter(r =>
        r.raw_subjects.includes(targetCode) ||
        r.subjects.includes(subject) ||
        r.raw_subjects.includes(subject)
      );
    }

    if (format) {
      rows = rows.filter(r => r.format === format);
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
    const rawSubs: string[] = typeof olympiad.subjects === 'string' ? JSON.parse(olympiad.subjects) : (olympiad.subjects || []);
    const ruSubs = rawSubs.map(s => SUBJECT_TO_RUSSIAN[s] || s);
    const itemStages = stagesRes.rows.map(s => ({ ...s, format: s.format || 'online' }));

    return {
      ...olympiad,
      subjects: ruSubs,
      format: itemStages[0]?.format || 'online',
      stages: itemStages,
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
      grade: user.grade || 10,
      region_code: user.region_code || '77',
      timezone: user.timezone || 'Europe/Moscow',
      quiet_from: user.quiet_from || '22:00',
      quiet_to: user.quiet_to || '08:00',
      consent_at: user.consent_at,
      subjects: subjectsRes.rows.map(r => SUBJECT_TO_RUSSIAN[r.subject_code] || r.subject_code),
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

    // Обновляем основные поля с защитой от NULL
    const cleanGrade = data.grade || user.grade || 10;
    const cleanRegion = data.region_code || user.region_code || '77';
    const cleanTimezone = data.timezone || user.timezone || 'Europe/Moscow';
    const cleanQuietFrom = data.quiet_from && data.quiet_from.trim() !== '' ? data.quiet_from : (user.quiet_from || '22:00');
    const cleanQuietTo = data.quiet_to && data.quiet_to.trim() !== '' ? data.quiet_to : (user.quiet_to || '08:00');

    await db.query(
      `UPDATE users SET
         grade = $1,
         region_code = $2,
         timezone = $3,
         quiet_from = $4,
         quiet_to = $5,
         updated_at = NOW()
       WHERE id = $6`,
      [cleanGrade, cleanRegion, cleanTimezone, cleanQuietFrom, cleanQuietTo, user.id]
    );

    // Обновляем предметы, если переданы (переводим из русских названий в коды при необходимости)
    if (data.subjects) {
      await db.query('DELETE FROM user_subjects WHERE user_id = $1', [user.id]);
      for (const s of data.subjects) {
        const code = RUSSIAN_TO_CODE[s] || s;
        await db.query(
          'INSERT INTO user_subjects (user_id, subject_code) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [user.id, code]
        );
      }
    }

    return {
      status: 'success',
      grade: cleanGrade,
      region_code: cleanRegion,
      timezone: cleanTimezone,
      quiet_from: cleanQuietFrom,
      quiet_to: cleanQuietTo,
      subjects: data.subjects || [],
    };
  });

  // --- DELETE /api/me (Удалить все данные) ---
  fastify.delete('/api/me', async (req, reply) => {
    const user = await authenticateUser(req, reply, db);
    if (!user) return;

    // 1. Удаляем подписки пользователя (все напоминания удаляются каскадно)
    await db.query('DELETE FROM subscriptions WHERE user_id = $1', [user.id]);
    // 2. Удаляем выбранные предметы
    await db.query('DELETE FROM user_subjects WHERE user_id = $1', [user.id]);
    // 3. Удаляем состояние диалога в боте
    await db.query('DELETE FROM dialog_state WHERE user_id = $1', [user.id]);
    // 4. Сбрасываем профиль к дефолтным значениям
    await db.query(
      `UPDATE users SET
         grade = 10,
         region_code = '77',
         timezone = 'Europe/Moscow',
         quiet_from = '22:00',
         quiet_to = '08:00',
         consent_at = NULL,
         updated_at = NOW()
       WHERE id = $1`,
      [user.id]
    );
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
      id: String(row.id),
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
       RETURNING id, status`,
      [user.id, olympiad_id]
    );
    const subId = subRes.rows[0].id;
    const subStatus = subRes.rows[0].status;

    // Генерируем напоминания
    const remCount = await generateRemindersForSubscription(db, subId, olympiad_id, user.id);

    return {
      id: String(subId),
      olympiad_id,
      status: subStatus,
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
      const res = await handleReminderAction(db, subId, 'registered', user.id);
      if (!res.success) {
        return reply.code(404).send({ error: 'Not Found', message: res.message });
      }
      return { id: String(subId), status, message: res.message };
    } else if (status === 'dropped') {
      const res = await handleReminderAction(db, subId, 'drop', user.id);
      if (!res.success) {
        return reply.code(404).send({ error: 'Not Found', message: res.message });
      }
      return { id: String(subId), status, message: res.message };
    } else {
      await db.query('UPDATE subscriptions SET status = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3', [
        status,
        subId,
        user.id,
      ]);
      return { id: String(subId), status, message: `Статус изменен на ${status}` };
    }
  });

  // --- GET /api/recommendations (Персональная подборка олимпиад) ---
  fastify.get('/api/recommendations', async (req, reply) => {
    const user = await authenticateUser(req, reply, db);
    if (!user) return;
    const list = await getRecommendationsForUser(db, user.id, 10);
    return list;
  });

  // --- СТАТИЧЕСКИЕ РЕСУРСЫ КЛИЕНТСКОГО MINI APP (VITE ASSETS) ---
  fastify.get('/assets/*', async (req: FastifyRequest<{ Params: { '*': string } }>, reply: FastifyReply) => {
    const assetPath = req.params['*'];
    const candidates = [
      path.resolve(process.cwd(), 'apps/miniapp/dist/assets', assetPath),
      path.resolve(process.cwd(), '../miniapp/dist/assets', assetPath),
      path.resolve(process.cwd(), 'apps/miniapp/public', assetPath),
      path.resolve(process.cwd(), '../miniapp/public', assetPath),
      path.resolve(__dirname, '../../../../apps/miniapp/dist/assets', assetPath),
      path.resolve(__dirname, '../../../miniapp/dist/assets', assetPath),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const ext = path.extname(p).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.js': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.json': 'application/json',
          '.woff2': 'font/woff2',
        };
        if (mimeTypes[ext]) reply.type(mimeTypes[ext]);
        return reply.send(fs.readFileSync(p));
      }
    }
    return reply.code(404).send({ error: 'Asset not found' });
  });

  // --- МИНИ-ПРИЛОЖЕНИЕ (MINI APP: КАТАЛОГ, ПОДБОРКА, ДЕДЛАЙНЫ, ПРОФИЛЬ) ---
  const serveAppHtml = async (req: FastifyRequest, reply: FastifyReply) => {
    const candidates = [
      path.resolve(process.cwd(), 'apps/miniapp/dist/index.html'),
      path.resolve(process.cwd(), '../miniapp/dist/index.html'),
      path.resolve(__dirname, '../../../../apps/miniapp/dist/index.html'),
      path.resolve(__dirname, '../../../miniapp/dist/index.html'),
      path.resolve(__dirname, 'app.html'),
      path.resolve(__dirname, '../src/api/app.html'),
      path.resolve(process.cwd(), 'apps/server/src/api/app.html'),
      path.resolve(process.cwd(), 'src/api/app.html'),
    ];
    for (const htmlPath of candidates) {
      if (fs.existsSync(htmlPath)) {
        const html = fs.readFileSync(htmlPath, 'utf-8');
        return reply.type('text/html; charset=utf-8').send(html);
      }
    }
    return reply.code(404).send({ error: 'app.html not found' });
  };

  fastify.get('/app', serveAppHtml);
  fastify.get('/app/*', serveAppHtml);
  fastify.get('/miniapp', serveAppHtml);
  fastify.get('/miniapp/*', serveAppHtml);
  fastify.get('/season', serveAppHtml);
  fastify.get('/settings', serveAppHtml);
  fastify.get('/olympiads/:id', serveAppHtml);
  fastify.get('/mockServiceWorker.js', async (req, reply) => {
    const candidates = [
      path.resolve(process.cwd(), 'apps/miniapp/dist/mockServiceWorker.js'),
      path.resolve(process.cwd(), '../miniapp/dist/mockServiceWorker.js'),
      path.resolve(process.cwd(), 'apps/miniapp/public/mockServiceWorker.js'),
      path.resolve(process.cwd(), '../miniapp/public/mockServiceWorker.js'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return reply.type('application/javascript; charset=utf-8').send(fs.readFileSync(p));
      }
    }
    return reply.code(404).send({ error: 'mockServiceWorker.js not found' });
  });
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
