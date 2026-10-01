#!/usr/bin/env node
// Dev mode: API server on :3001 with a fixed token + Vite (HMR) on :5173.
// The server restarts on its own when server/ or shared/ change (the UI already reloads through Vite),
// so the two never drift apart. A restart stops running agents.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = spawn(
  process.execPath,
  ['--watch-path=./server', '--watch-path=./shared', '--watch-preserve-output', 'bin/dev-server.js'],
  { cwd: ROOT, stdio: 'inherit' },
);
const vite = spawn('npx', ['vite', '--open', '/?token=dev'], { cwd: ROOT, stdio: 'inherit' });
console.log('\n  Mở: http://localhost:5173/?token=dev (link localhost:5173 của Vite cũng vào được)\n  Sửa code server thì server tự khởi động lại.\n');
const stop = () => {
  vite.kill();
  server.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
