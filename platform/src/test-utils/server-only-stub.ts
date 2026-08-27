/**
 * Stub for the `server-only` package used in vitest.
 *
 * The real `server-only` package (used by the Next.js bundler) throws at
 * import time when the module is loaded outside a React Server Component
 * context. Under vitest there is no Next.js bundler, so we alias
 * `server-only` → this file in vitest.config.ts to make the import a no-op.
 *
 * This stub must never be imported from production code — it is test-only.
 */
export {};
