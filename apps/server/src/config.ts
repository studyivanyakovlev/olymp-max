import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Загружаем .env из корня проекта или текущего каталога
const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
];
for (const p of envCandidates) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
  }
}
dotenv.config();

export interface Config {
  port: number;
  botToken: string;
  telegramToken: string;
  botMode: 'polling' | 'webhook';
  publicUrl: string;
  databaseUrl: string;
  miniappUrl: string;
  demoMode: boolean;
  isDev: boolean;
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  botToken: process.env.BOT_TOKEN || 'mock_token',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  botMode: (process.env.BOT_MODE as 'polling' | 'webhook') || 'polling',
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL || '',
  miniappUrl: process.env.MINIAPP_URL || 'http://localhost:3000/app',
  demoMode: process.env.DEMO_MODE !== 'false',
  isDev: process.env.NODE_ENV !== 'production',
};
