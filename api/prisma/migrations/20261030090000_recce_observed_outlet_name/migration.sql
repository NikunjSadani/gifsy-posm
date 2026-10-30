-- Outlet name as observed by the rep at recce time (pre-filled from the master, editable).
-- Nullable + additive: existing recces keep NULL (fall back to the master name).
ALTER TABLE "recces" ADD COLUMN "observedOutletName" TEXT;
