import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { getDb, Database } from './index.js';
import { recalculateStageReminders } from '../domain/reminders.js';

const ajv = new (Ajv as any)({ allErrors: true });
(addFormats as any)(ajv);

export function findDataFile(relPath: string): string {
  const candidates = [
    path.resolve(process.cwd(), relPath),
    path.resolve(process.cwd(), '../../', relPath),
    path.resolve(process.cwd(), '../', relPath),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.resolve(process.cwd(), relPath);
}

export async function validateDataset(schemaPath: string, data: any): Promise<boolean> {
  const resolvedSchemaPath = findDataFile(schemaPath);
  const schemaContent = JSON.parse(fs.readFileSync(resolvedSchemaPath, 'utf-8'));
  const validate = ajv.compile(schemaContent);
  const valid = validate(data);
  if (!valid) {
    const errorDetails = (validate.errors || [])
      .map((e: any) => `Поле "${e.instancePath}": ${e.message} (${JSON.stringify(e.params)})`)
      .join('\n');
    throw new Error(`Ошибка валидации датасета против схемы ${resolvedSchemaPath}:\n${errorDetails}`);
  }
  return true;
}

export async function importDataset(filePath: string, db: Database): Promise<{ olympiadsCount: number; stagesCount: number; updatedCount: number }> {
  const schemaPath = findDataFile('data/schema.json');
  const resolvedFilePath = findDataFile(filePath);
  const data = JSON.parse(fs.readFileSync(resolvedFilePath, 'utf-8'));

  // 1. Проверяем валидность по схеме
  await validateDataset(schemaPath, data);

  let olympiadsCount = 0;
  let stagesCount = 0;
  let updatedCount = 0;

  for (const item of data) {
    // Вставляем или обновляем олимпиаду
    await db.query(
      `INSERT INTO olympiads (
        id, title, organizer, rsosh_level, subjects, grade_from, grade_to,
        benefits_note, url, source_url, verified_at, is_demo, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        organizer = EXCLUDED.organizer,
        rsosh_level = EXCLUDED.rsosh_level,
        subjects = EXCLUDED.subjects,
        grade_from = EXCLUDED.grade_from,
        grade_to = EXCLUDED.grade_to,
        benefits_note = EXCLUDED.benefits_note,
        url = EXCLUDED.url,
        source_url = EXCLUDED.source_url,
        verified_at = EXCLUDED.verified_at,
        is_demo = EXCLUDED.is_demo,
        updated_at = NOW()`,
      [
        item.id,
        item.title,
        item.organizer,
        item.rsosh_level,
        JSON.stringify(item.subjects),
        item.grade_from,
        item.grade_to,
        item.benefits_note,
        item.url,
        item.source_url,
        item.verified_at,
        item.is_demo || false,
      ]
    );
    olympiadsCount++;

    // Обрабатываем этапы
    for (const stage of item.stages) {
      // Проверяем существующий этап на сдвиг дат
      const existing = await db.query<{ starts_at: string; ends_at: string }>(
        'SELECT starts_at, ends_at FROM stages WHERE id = $1',
        [stage.id]
      );

      const startsAt = new Date(stage.starts_at).toISOString();
      const endsAt = new Date(stage.ends_at).toISOString();

      let dateChanged = false;
      if (existing.rowCount > 0) {
        const oldStart = new Date(existing.rows[0].starts_at).toISOString();
        const oldEnd = new Date(existing.rows[0].ends_at).toISOString();
        if (oldStart !== startsAt || oldEnd !== endsAt) {
          dateChanged = true;
          updatedCount++;
        }
      }

      await db.query(
        `INSERT INTO stages (
          id, olympiad_id, kind, name, starts_at, ends_at, region_code, format
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          kind = EXCLUDED.kind,
          name = EXCLUDED.name,
          starts_at = EXCLUDED.starts_at,
          ends_at = EXCLUDED.ends_at,
          region_code = EXCLUDED.region_code,
          format = EXCLUDED.format`,
        [
          stage.id,
          item.id,
          stage.kind,
          stage.name,
          startsAt,
          endsAt,
          stage.region_code || null,
          stage.format,
        ]
      );
      stagesCount++;

      // Если дата сдвинулась — пересчитываем неотправленные напоминания
      if (dateChanged) {
        console.log(`! Обнаружен сдвиг дат для этапа "${stage.name}" (${stage.id}). Пересчёт напоминаний...`);
        await recalculateStageReminders(db, stage.id, item.title, stage.name, startsAt, endsAt);
      }
    }
  }

  return { olympiadsCount, stagesCount, updatedCount };
}

export async function runSeed(existingDb?: Database) {
  console.log('--- Запуск импорта датасетов ---');
  const db = existingDb || (await getDb());

  const olympiadsFile = findDataFile('data/olympiads.json');
  const demoFile = findDataFile('data/demo.json');

  if (fs.existsSync(olympiadsFile)) {
    console.log(`Импорт основного датасета из ${olympiadsFile}...`);
    const res = await importDataset(olympiadsFile, db);
    console.log(`✓ Загружено олимпиад: ${res.olympiadsCount}, этапов: ${res.stagesCount}`);
  } else {
    console.warn(`! Файл ${olympiadsFile} не найден`);
  }

  if (fs.existsSync(demoFile)) {
    console.log(`Импорт демо-олимпиады для жюри из ${demoFile}...`);
    const resDemo = await importDataset(demoFile, db);
    console.log(`✓ Загружено демо-олимпиад: ${resDemo.olympiadsCount}`);
  }

  console.log('--- Импорт успешно завершён ---');
  return db;
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  runSeed()
    .then(async (db) => {
      // Обязательно корректно закрываем базу для сброса на диск PGlite
      if (db) await db.close();
      process.exit(0);
    })
    .catch((err) => {
      console.error('Ошибка импорта датасета:', err);
      process.exit(1);
    });
}
