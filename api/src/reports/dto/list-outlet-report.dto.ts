import { IsOptional, IsString, IsInt, IsIn, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Filters for the Outlet Execution Report (GET /v1/reports/outlet-execution[.xlsx]). All optional;
 * text filters are case-insensitive `contains`. page/limit apply to the on-screen JSON view only
 * (the .xlsx export returns every matching row up to a hard server cap).
 */
export class ListOutletReportDto {
  @IsOptional()
  @IsString()
  siteCode?: string;

  @IsOptional()
  @IsString()
  town?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  vendorId?: string;

  /**
   * Comma-separated outlet codes for the PPT export (GET /v1/reports/outlet-execution.pptx) — 1–3
   * codes, validated in the service (else 400). Ignored by the JSON table + xlsx paths.
   */
  @IsOptional()
  @IsString()
  outletCodes?: string;

  /**
   * The report variant: `recce` (default) is the original recce report; `installed` adds the
   * per-element install status + photo, install metadata and the install audit trail (JSON + .xlsx),
   * and the before/after slide (.pptx). `@IsIn` rejects any OTHER value with a 400 — only an OMITTED
   * `mode` defaults to `recce` (the service's `reportMode` normalises `undefined` → `recce`).
   */
  @IsOptional()
  @IsIn(['recce', 'installed'])
  mode?: 'recce' | 'installed';

  /**
   * The caller's browser origin (`window.location.origin`), sent ONLY by the .xlsx download so the
   * backend — which sits behind the Next proxy and can't know the public origin — can build ABSOLUTE
   * photo hyperlinks (`<origin>/api/media/view?key=…`) that open from Excel. Validated as a plausible
   * `http(s)://host` before use (invalid ⇒ relative-link fallback); never affects the JSON view.
   */
  @IsOptional()
  @IsString()
  origin?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
