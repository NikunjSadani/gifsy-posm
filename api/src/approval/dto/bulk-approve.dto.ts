import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';

/**
 * Body for POST /v1/approval/recces/bulk-approve. A non-empty list of recce ids to approve.
 * Capped so an untrusted payload cannot request an unbounded batch. Bulk is approve-only —
 * rejection is individual (it requires a per-recce reason code).
 */
export class BulkApproveDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids: string[];
}
