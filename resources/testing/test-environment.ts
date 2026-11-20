import { inject } from 'vitest';

const isolated = inject('testDatabaseUrl');
if (isolated) process.env.TEST_DATABASE_URL = isolated;

process.env.HEXAGON_ACCESS_URL ??= 'https://credentials.test';
