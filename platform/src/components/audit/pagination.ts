/**
 * Pure pagination helper for the auditor queue. Kept side-effect-free so it can be
 * unit-tested and shared between the queue page and its controls.
 */

/**
 * Total number of pages for `total` items at `pageSize` per page.
 * Always at least 1 (an empty queue still renders "Page 1 of 1"), and never fractional.
 * Guards against a non-positive / non-finite `pageSize`.
 */
export function pageCount(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}
