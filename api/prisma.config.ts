// Prisma 7 CLI config. The datasource URL is supplied by the schema's inline
// `url = env("DATABASE_URL")`, so it is NOT repeated here. `prisma generate`,
// `nest build`, and `tsc` do not need a live DATABASE_URL; `prisma migrate` does.
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
