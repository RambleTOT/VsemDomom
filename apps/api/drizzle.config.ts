import { defineConfig } from 'drizzle-kit';

// Миграции генерируются из src/db/schema.ts в db/migrations (корень репозитория).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: '../../db/migrations',
  strict: true,
  verbose: true,
});
