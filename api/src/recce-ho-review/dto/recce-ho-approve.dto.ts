import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for POST /v1/recce-ho-review/recces/:id/approve.
 *
 * `outletId` is the final Outlet ID (Site.code) HO assigns. It is:
 *   - MANDATORY for a MANUAL recce UNLESS the attached outlet already carries a real (non-provisional)
 *     code — a manual recce whose outlet is still `MAN-…` cannot be approved without one (400).
 *   - EDITABLE: HO may set it, or overwrite an existing one. Reassigning to an Outlet ID that already
 *     belongs to a DIFFERENT outlet is a 409 (the FE warns/confirms).
 *   - IGNORED for an APP recce (its outlet is already in the master; approve just flips the HO stage).
 *
 * Optional + a plain body, so the app-recce approve (which sends no body) still validates.
 */
export class RecceHoApproveDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  outletId?: string;

  /**
   * When `outletId` collides with an EXISTING outlet, `true` ATTACHES this manual recce to that
   * outlet (re-parents it, no duplicate, no rename) instead of returning a 409. Only within the same
   * fleet (vendor). Default/omitted = the safe "pick a different ID" behaviour.
   */
  @IsOptional()
  @IsBoolean()
  attachToExisting?: boolean;
}
