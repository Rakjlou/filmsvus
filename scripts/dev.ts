import { createServer } from 'vite';
import { buildApp } from '../server/index.ts';

// Both servers share .env and shut down together, without a platform-specific shell.
const api = buildApp({ logger: true, production: false });
const vite = await createServer();
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  await Promise.allSettled([api.close(), vite.close()]);
  process.exitCode = code;
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
try {
  await api.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
  await vite.listen();
  vite.printUrls();
} catch (error) { console.error(error); await close(1); }
