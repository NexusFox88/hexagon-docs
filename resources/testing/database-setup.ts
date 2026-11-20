import { randomUUID } from 'node:crypto';
import type { TestProject } from 'vitest/node';
import { openDatabase } from '../modules/storage/database.js';
import { migrate } from '../modules/storage/migrate.js';

declare module 'vitest' { export interface ProvidedContext { testDatabaseUrl: string } }

/** Preserve development data: the global scheduler needs its own database namespace. */
export default async function setup(project: TestProject) {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) return;
  const schema = `hexagon_test_${randomUUID().replaceAll('-', '')}`;
  const admin = openDatabase(source);
  const url = new URL(source);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const isolated = openDatabase(url.toString());
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await migrate(isolated);
    project.provide('testDatabaseUrl', url.toString());
  } catch (error) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
    throw error;
  } finally { await isolated.end(); }
  return async () => {
    try { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await admin.end(); }
  };
}
