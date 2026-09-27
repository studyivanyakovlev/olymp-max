import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Database } from '../db/index.js';
import { registerApiRoutes } from './routes.js';
import { Bot } from '@maxhub/max-bot-api';

export async function createServer(db: Database, bot?: Bot): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: false, // Отключаем логирование запросов с персональными данными (Ar.pdf: "В логи не пишем тексты сообщений и initData")
  });

  // Настройка CORS для Mini App
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-init-data', 'x-user-id'],
  });

  // Swagger / OpenAPI документация
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Олимпиадный навигатор в MAX API',
        description: 'REST API бэкенда для взаимодействия с Mini App и платформой MAX',
        version: '1.0.0',
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Локальный сервер разработки',
        },
      ],
      components: {
        securitySchemes: {
          InitDataAuth: {
            type: 'apiKey',
            name: 'x-init-data',
            in: 'header',
            description: 'Строка WebApp.initData от MAX Bridge с HMAC подписью',
          },
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  // Регистрация маршрутов API
  registerApiRoutes(fastify, db);

  // Эндпоинт Вебхука MAX Bot API
  fastify.post('/webhook', async (req, reply) => {
    if (bot) {
      try {
        await (bot as any).handleUpdate(req.body as any);
        return reply.code(200).send({ ok: true });
      } catch (err: any) {
        console.error('Ошибка обработки вебхука:', err.message);
        return reply.code(200).send({ ok: false, error: err.message });
      }
    }
    return reply.code(200).send({ ok: true });
  });

  return fastify;
}
