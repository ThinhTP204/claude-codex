// Task board backlog: tasks the user writes down per project before handing them to an agent.
// Sessions themselves are the rest of the board (their status decides the column).
import type { BacklogTask } from '../shared/types.ts';
import { dataFile, readJson, uid, writeJson } from './store.ts';

const FILE = dataFile('tasks.json');

const all = () => readJson<Record<string, BacklogTask[]>>(FILE, {});

function save(project: string, tasks: BacklogTask[]): BacklogTask[] {
  const data = all();
  if (tasks.length) data[project] = tasks;
  else delete data[project];
  writeJson(FILE, data);
  return tasks;
}

export const listTasks = (project: string): BacklogTask[] => all()[project] ?? [];

export function addTask(project: string, o: { title: string; note?: string }): BacklogTask[] {
  const title = String(o.title || '').trim();
  if (!title) throw new Error('Task cần có tên.');
  const t: BacklogTask = { id: uid('k_'), title: title.slice(0, 200), note: o.note?.trim() || undefined, createdAt: Date.now() };
  return save(project, [...listTasks(project), t]);
}

export function updateTask(project: string, id: string, o: { title?: string; note?: string }): BacklogTask[] {
  return save(
    project,
    listTasks(project).map((t) =>
      t.id === id ? { ...t, title: o.title?.trim() ? o.title.trim().slice(0, 200) : t.title, note: o.note !== undefined ? o.note.trim() || undefined : t.note } : t,
    ),
  );
}

export const removeTask = (project: string, id: string): BacklogTask[] => save(project, listTasks(project).filter((t) => t.id !== id));
