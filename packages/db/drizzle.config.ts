import { defineConfig } from 'drizzle-kit'

// `npm run generate --workspace @vo/db` writes SQL migrations to ./drizzle; createDb applies them at start.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
})
