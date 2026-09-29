import { defineConfig } from 'vitest/config';

// Тесты не должны видеть настоящий .env: dotenv не перезаписывает уже заданные переменные,
// поэтому здесь задаём тестовые токены и пустой DATABASE_URL (встроенный PGlite в памяти).
export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      BOT_TOKEN: 'test_bot_token',
      DATABASE_URL: '',
      BOT_MODE: 'polling',
      DEMO_MODE: 'true',
    },
  },
});
