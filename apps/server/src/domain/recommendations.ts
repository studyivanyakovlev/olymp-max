import { Database } from '../db/index.js';

export interface OlympiadCard {
  id: string;
  title: string;
  organizer: string;
  rsosh_level: number | null;
  subjects: string[];
  grade_from: number;
  grade_to: number;
  benefits_note: string;
  url: string;
  source_url: string;
  verified_at: string;
  is_demo?: boolean;
  score?: number;
  next_deadline?: NextDeadline | null;
}

export interface StageRow {
  olympiad_id: string;
  kind: 'registration' | 'qualifying' | 'final' | 'results';
  name: string;
  starts_at: string | Date;
  ends_at: string | Date;
}

/** Ближайшее действие по олимпиаде: открытая регистрация, будущая регистрация или тур */
export interface NextDeadline {
  kind: StageRow['kind'];
  stage_name: string;
  starts_at: string;
  ends_at: string;
  /** Этап уже идёт: регистрация открыта или тур проходит сейчас */
  is_open: boolean;
}

const DAY_MS = 24 * 3600 * 1000;
const time = (d: string | Date) => new Date(d).getTime();

export function pickNextDeadline(
  stages: StageRow[],
  now: Date = new Date(),
  options: { skipRegistration?: boolean } = {}
): { next: NextDeadline | null; registrationClosed: boolean } {
  const t = now.getTime();
  const regs = stages.filter(s => s.kind === 'registration');
  const registrationClosed = regs.length > 0 && regs.every(s => time(s.ends_at) <= t);
  const upcoming = stages.filter(s => time(s.ends_at) > t);

  const byEnd = (a: StageRow, b: StageRow) => time(a.ends_at) - time(b.ends_at);
  const byStart = (a: StageRow, b: StageRow) => time(a.starts_at) - time(b.starts_at);

  const openReg = options.skipRegistration
    ? undefined
    : upcoming.filter(s => s.kind === 'registration' && time(s.starts_at) <= t).sort(byEnd)[0];
  const futureReg = options.skipRegistration
    ? undefined
    : upcoming.filter(s => s.kind === 'registration' && time(s.starts_at) > t).sort(byStart)[0];
  const tour = upcoming.filter(s => s.kind === 'qualifying' || s.kind === 'final').sort(byStart)[0];

  const stage = openReg ?? futureReg ?? tour;
  if (!stage) return { next: null, registrationClosed };
  return {
    next: {
      kind: stage.kind,
      stage_name: stage.name,
      starts_at: new Date(stage.starts_at).toISOString(),
      ends_at: new Date(stage.ends_at).toISOString(),
      is_open: time(stage.starts_at) <= t,
    },
    registrationClosed,
  };
}

/** Момент, к которому нужно успеть: конец открытой регистрации или начало будущего этапа */
export function deadlineMoment(next: NextDeadline): number {
  return next.is_open && next.kind === 'registration' ? time(next.ends_at) : time(next.starts_at);
}

export async function getRecommendationsForUser(
  db: Database,
  userId: number,
  limit: number = 7
): Promise<OlympiadCard[]> {
  // 1. Получаем профиль пользователя и выбранные предметы
  const userRes = await db.query(
    'SELECT grade, region_code FROM users WHERE id = $1',
    [userId]
  );
  const user = userRes.rows[0];
  const userGrade = user?.grade || 10; // по умолчанию 10 класс если не указан

  const subjectsRes = await db.query<{ subject_code: string }>(
    'SELECT subject_code FROM user_subjects WHERE user_id = $1',
    [userId]
  );
  const userSubjects = new Set(subjectsRes.rows.map(r => r.subject_code));

  // 2. Получаем олимпиады из БД
  const olyRes = await db.query(
    `SELECT id, title, organizer, rsosh_level, subjects, grade_from, grade_to,
            benefits_note, url, source_url, verified_at, is_demo
     FROM olympiads`
  );

  const stagesRes = await db.query<StageRow>(
    'SELECT olympiad_id, kind, name, starts_at, ends_at FROM stages'
  );
  const stagesByOlympiad = new Map<string, StageRow[]>();
  for (const st of stagesRes.rows) {
    const list = stagesByOlympiad.get(st.olympiad_id) ?? [];
    list.push(st);
    stagesByOlympiad.set(st.olympiad_id, list);
  }

  const now = new Date();
  const scored: OlympiadCard[] = [];

  for (const row of olyRes.rows) {
    const subjects: string[] = typeof row.subjects === 'string' ? JSON.parse(row.subjects) : row.subjects;

    // Проверка класса
    if (userGrade < row.grade_from || userGrade > row.grade_to) {
      continue;
    }

    // Прошедшие олимпиады и олимпиады с закрытой регистрацией не рекомендуем:
    // участвовать в них уже нельзя (в каталоге они остаются)
    const { next, registrationClosed } = pickNextDeadline(stagesByOlympiad.get(row.id) ?? [], now);
    if (!row.is_demo && (!next || registrationClosed)) {
      continue;
    }

    let score = 0;

    // Открытая регистрация важнее будущей, а до закрытия меньше недели — ещё важнее
    if (next?.kind === 'registration' && next.is_open) {
      score += 15;
      if (time(next.ends_at) - now.getTime() < 7 * DAY_MS) score += 5;
    }

    // Демо-олимпиада всегда имеет наивысший приоритет для жюри
    if (row.is_demo) {
      score += 1000;
    }

    // Совпадение по предметам
    let subjectMatchCount = 0;
    for (const s of subjects) {
      if (userSubjects.has(s)) {
        subjectMatchCount++;
        score += 20;
      }
    }

    // Бонус за уровень РСОШ
    if (row.rsosh_level === 1) score += 10;
    else if (row.rsosh_level === 2) score += 6;
    else if (row.rsosh_level === 3) score += 3;
    else score += 1;

    // Олимпиады по другим предметам показываем только после всех совпадающих
    if (userSubjects.size > 0 && subjectMatchCount === 0 && !row.is_demo) {
      score -= 40;
    }

    scored.push({
      ...row,
      subjects,
      score,
      next_deadline: next,
    });
  }

  // По убыванию очков, при равенстве — у кого дедлайн ближе
  const soonest = (c: OlympiadCard) => (c.next_deadline ? deadlineMoment(c.next_deadline) : Infinity);
  scored.sort((a, b) => (b.score || 0) - (a.score || 0) || soonest(a) - soonest(b));

  return scored.slice(0, limit);
}
