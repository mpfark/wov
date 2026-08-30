// Use the project's installed Vite transform so the TypeScript entry point
// executes without adding a second runtime dependency.
import { createServer } from 'vite';

const server = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true } });
try {
  await server.ssrLoadModule('/scripts/combat2-tick-once.ts');
} finally {
  await server.close();
}
