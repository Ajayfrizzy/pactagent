import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

const datasourceUrl = process.env.DIRECT_URL || env('DATABASE_URL');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: datasourceUrl,
  },
});
