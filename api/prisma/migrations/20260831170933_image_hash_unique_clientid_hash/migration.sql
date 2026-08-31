-- Fix 2 (anti-fraud, money path): promote image_hashes (clientId, hash) from a plain index to a
-- UNIQUE so that ANY exact-byte photo reuse within a tenant collides at the database — closing the
-- read-then-write cross-submission duplicate race (two concurrent installs reusing one photo can no
-- longer both commit). See prisma/schema.prisma `model ImageHash`.
--
-- SELF-HEALING PRE-STEP: a UNIQUE cannot be added while legacy duplicate (clientId, hash) rows
-- exist (rows recorded before this constraint). Remove them first, keeping the EARLIEST row per
-- (clientId, hash) group (it carries the original owner); delete the rest. This is safe: these
-- hash rows are DERIVED data (recomputable from the photos) and the retained earliest row preserves
-- the duplicate-detection semantics. Idempotent — a no-op once the table already has no duplicates.
DELETE FROM "image_hashes" a
USING "image_hashes" b
WHERE a."clientId" = b."clientId"
  AND a."hash" = b."hash"
  AND (a."createdAt" > b."createdAt"
       OR (a."createdAt" = b."createdAt" AND a."id" > b."id"));

-- DropIndex
DROP INDEX "image_hashes_clientId_hash_idx";

-- CreateIndex
CREATE UNIQUE INDEX "image_hashes_clientId_hash_key" ON "image_hashes"("clientId", "hash");
