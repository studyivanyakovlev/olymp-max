import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { config } from '../config.js';
import { schemaSql } from './migrations.js';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface Database {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  close(): Promise<void>;
  isPGlite: boolean;
}

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  // 1. Попытка подключения к внешнему PostgreSQL, если задан DATABASE_URL
  if (config.databaseUrl && (config.databaseUrl.startsWith('postgres://') || config.databaseUrl.startsWith('postgresql://'))) {
    try {
      const pool = new Pool({
        connectionString: config.databaseUrl,
        connectionTimeoutMillis: 3000,
      });

      // Проверяем подключение
      await pool.query('SELECT 1');
      console.log('✓ Подключено к внешней базе данных PostgreSQL');

      const db: Database = {
        async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
          const res = await pool.query(sql, params);
          return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
        },
        async close() {
          await pool.end();
        },
        isPGlite: false,
      };

      // Применяем миграции схемы
      await db.query(schemaSql);
      dbInstance = db;
      return db;
    } catch (err: any) {
      console.warn(`! Не удалось подключиться к PostgreSQL (${err.message}). Переключаемся на встроенный локальный PGlite.`);
    }
  }

  // 2. Встроенный локальный PostgreSQL через PGlite (не требует запущенного демона PostgreSQL или Docker)
  const isTest = process.env.NODE_ENV === 'test';
  let pglite: PGlite;
  if (isTest) {
    pglite = new PGlite();
  } else {
    // Храним базу в домашней директории пользователя (~/.olymp_max_pglite),
    // чтобы избежать сбоев блокировок файловой системы на смонтированных NTFS дисках (/mnt/...)
    const dataDir = process.env.PGLITE_DIR || path.resolve(os.homedir(), '.olymp_max_pglite');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    pglite = new PGlite(dataDir);
  }
  await pglite.waitReady;
  console.log(`✓ Запущен встроенный локальный PostgreSQL (PGlite: ${isTest ? 'in-memory' : process.env.PGLITE_DIR || '~/.olymp_max_pglite'})`);

  const db: Database = {
    async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
      const res = await pglite.query<T>(sql, params);
      // rowCount из тега команды, как в pg: для INSERT/UPDATE/DELETE без RETURNING rows пуст
      return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
    },
    async close() {
      await pglite.close();
    },
    isPGlite: true,
  };

  // Применяем миграции схемы (exec поддерживает множественные DDL команды)
  await pglite.exec(schemaSql);
  dbInstance = db;
  return db;
}
