/**
 * Shared return shape for every Excel bulk mutation (upload, bulk-deactivate) across domains.
 *
 * A caller gets per-batch counts plus two OPTIONAL base64 .xlsx payloads:
 *  - `errorFileBase64`  — the rejected rows + a per-row reason (null when nothing was rejected);
 *  - `successFileBase64` — the applied rows + the action taken per row (null when nothing applied).
 *
 * The frontend downloads either file by decoding the base64 into an .xlsx blob. `successCount`
 * counts every row that was applied (e.g. a deactivation AND a no-op "already inactive" both count
 * as success); `errorCount` counts the rejected rows; `rowCount` is the total data-row count.
 */
export interface BulkUploadResult {
  /** Correlation id for the batch (also stamped on the ingestion AuditLog entry). */
  batchId: string;
  rowCount: number;
  successCount: number;
  errorCount: number;
  /** base64 .xlsx of the rejected rows + reasons, or null when errorCount is 0. */
  errorFileBase64: string | null;
  /** base64 .xlsx of the applied rows + per-row action, or null when successCount is 0. */
  successFileBase64: string | null;
}
