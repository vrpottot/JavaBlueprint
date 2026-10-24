import { buildApp } from './app.js';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if (existsSync('.env')) loadEnvFile('.env');
const app = buildApp({ logger: true });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close(); });
try {
  await app.listen({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 3001) });
} catch (error) { app.log.error(error); process.exitCode = 1; }
