import fs from 'fs';
import path from 'path';
import tls from 'tls';
import { fileURLToPath } from 'url';
import { Bot, Api } from '@maxhub/max-bot-api';
import { Agent, fetch as undiciFetch } from 'undici';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Сертификат platform-api2.max.ru выпущен Russian Trusted Sub CA (Минцифры РФ).
// Корневого сертификата Минцифры нет в хранилище Node.js, поэтому добавляем его
// к стандартным корневым сертификатам только для запросов к MAX Bot API.
// Проверка TLS остаётся включённой, остальные HTTPS-запросы процесса не затрагиваются.
const CA_FILE = 'russian_trusted_root_ca.pem';

function loadRussianRootCa(): string | null {
  const candidates = [
    process.env.MAX_CA_CERT,
    path.resolve(__dirname, '../../certs', CA_FILE), // src/bot или dist/bot
    path.resolve(process.cwd(), 'certs', CA_FILE),
    path.resolve(process.cwd(), 'apps/server/certs', CA_FILE),
  ].filter(Boolean) as string[];

  for (const file of candidates) {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf-8');
  }
  console.warn(`⚠️ [MAX] Не найден ${CA_FILE}: запросы к MAX Bot API могут падать с ошибкой сертификата`);
  return null;
}

const russianRootCa = loadRussianRootCa();

const maxAgent = new Agent({
  connect: {
    ca: russianRootCa ? [...tls.rootCertificates, russianRootCa] : [...tls.rootCertificates],
  },
});

export const maxFetch: typeof fetch = (url: any, init: any = {}) =>
  undiciFetch(url, { ...init, dispatcher: maxAgent }) as any;

export function createMaxBot(): Bot {
  return new Bot(config.botToken, { clientOptions: { fetch: maxFetch } });
}

export function createMaxApi(): Api {
  return createMaxBot().api;
}

