-- Add soft capture-quality flags to recce POSM lines (blur/lowLight/overexposed/duplicate/
-- lowAccuracy), computed at submit. Mirrors install_posms.qualityFlags. Nullable + additive.
ALTER TABLE "recce_posms" ADD COLUMN "qualityFlags" JSONB;
