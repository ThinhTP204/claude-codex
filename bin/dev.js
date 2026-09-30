#!/usr/bin/env node
// Dev mode: API server on :3001 with a fixed token + Vite (HMR) on :5173
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { start } = await import('../server/index.ts');
await start({ port: 3001, token: 'dev' });
const vite = spawn('npx', ['vite'], { cwd: ROOT, stdio: 'inherit' });
console.log('\n  Mở: http://localhost:5173/?token=dev\n');
process.on('SIGINT', () => {
  vite.kill();
  process.exit(0);
});
