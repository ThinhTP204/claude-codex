import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const HOME = os.homedir();
export const DATA_DIR = process.env.AGENTDESK_HOME || path.join(HOME, '.agentdesk');
export const CONV_DIR = path.join(DATA_DIR, 'conversations');

fs.mkdirSync(CONV_DIR, { recursive: true });

export function uid(prefix = ''): string {
  return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Atomic write so a crash mid-write never corrupts the file */
export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export const dataFile = (name: string) => path.join(DATA_DIR, name);

export function realpathSafe(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}
