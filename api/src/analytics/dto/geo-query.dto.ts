import { IsIn, IsOptional } from 'class-validator';

/** Which pipeline lens the geo/heatmap points are drawn for. */
export type AnalyticsStage = 'recce' | 'install';

/**
 * Query for GET /v1/analytics/geo. `stage` selects the map lens:
 *   recce   (default) → every scoped site with coordinates (coverage incl. un-recced gaps).
 *   install           → scoped sites with coordinates that carry an installation record.
 * Both carry the full `furthestStage`, so the client can colour the heatmap either way.
 */
export class GeoQueryDto {
  @IsOptional()
  @IsIn(['recce', 'install'])
  stage?: AnalyticsStage;
}
