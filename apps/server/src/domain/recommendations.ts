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

  const scored: OlympiadCard[] = [];

  for (const row of olyRes.rows) {
    const subjects: string[] = typeof row.subjects === 'string' ? JSON.parse(row.subjects) : row.subjects;

    // Проверка класса
    if (userGrade < row.grade_from || userGrade > row.grade_to) {
      continue;
    }

    let score = 0;

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

    // Если у пользователя выбраны предметы, отдаем приоритет совпадающим
    if (userSubjects.size > 0 && subjectMatchCount === 0 && !row.is_demo) {
      score -= 5;
    }

    scored.push({
      ...row,
      subjects,
      score,
    });
  }

  // Сортируем по убыванию очков
  scored.sort((a, b) => (b.score || 0) - (a.score || 0));

  return scored.slice(0, limit);
}
