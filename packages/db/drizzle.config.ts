import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'mysql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'mysql://civicscope:civicscope@127.0.0.1:3306/civicscope',
  },
  strict: true,
  verbose: true,
});
