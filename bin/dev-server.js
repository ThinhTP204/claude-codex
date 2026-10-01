#!/usr/bin/env node
// The API server of `npm run dev` (port 3001, token "dev"). bin/dev.js runs it under `node --watch`
// so it restarts by itself when server/ or shared/ change.
const { start } = await import('../server/index.ts');
await start({ port: 3001, token: 'dev' });
