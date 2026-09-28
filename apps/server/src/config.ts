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

function resolveMiniappUrl(): string {
  const candidates = [
    path.resolve(process.cwd(), 'tunnel_url.txt'),
    path.resolve(process.cwd(), '../tunnel_url.txt'),
    path.resolve(process.cwd(), '../../tunnel_url.txt'),
    '/opt/raspberry/bots/tunnel_url.txt',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const u = fs.readFileSync(c, 'utf-8').trim();
        if (u.startsWith('https://')) {
          return u.endsWith('/app') ? u : `${u}/app`;
        }
      } catch {}
    }
  }
  return process.env.MINIAPP_URL || 'http://localhost:3000/app';
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  botToken: process.env.BOT_TOKEN || 'mock_token',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  botMode: (process.env.BOT_MODE as 'polling' | 'webhook') || 'polling',
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL || '',
  get miniappUrl(): string {
    return resolveMiniappUrl();
  },
  demoMode: process.env.DEMO_MODE !== 'false',
  isDev: process.env.NODE_ENV !== 'production',
};
