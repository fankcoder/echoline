import { buildApp } from './app.js';

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const app = await buildApp({ production: process.env.NODE_ENV === 'production' });

try {
  await app.listen({ port, host });
  app.log.info(`EchoLine 已启动：http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
