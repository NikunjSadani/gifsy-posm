'use client';

/**
 * Leaflet/OpenStreetMap execution heatmap — CLIENT-ONLY (Leaflet touches `window` at import).
 * NEVER import this directly from a page; load it through `GeoMap` which wraps it in
 * `next/dynamic` with `ssr:false`. Mirrors the existing field `nearby-map.tsx` usage.
 *
 * One pin per geotagged site, coloured by the furthest stage it reached (a practical progress
 * heatmap). Sites without lat/lng are dropped (not plotted). Tapping a pin calls `onSelect`.
 */

import { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, useMap, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { stageColor, STAGE_LABELS, type GeoPoint } from '@/lib/analytics/api';

/** India centroid — fallback centre before/without any plotted points. */
const INDIA_CENTER: [number, number] = [22.5937, 78.9629];

function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'analytics-pin',
    html: `<span style="
      display:block;width:16px;height:16px;border-radius:50% 50% 50% 0;
      background:${color};transform:rotate(-45deg);
      border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 16],
  });
}

/** Fit the map to the plotted points once, so every site is visible without manual panning. */
function FitBounds({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();
  useMemo(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 12);
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
  }, [points, map]);
  return null;
}

export interface GeoMapInnerProps {
  points: GeoPoint[];
  onSelect?: (point: GeoPoint) => void;
}

export default function GeoMapInner({ points, onSelect }: GeoMapInnerProps) {
  const plotted = useMemo(
    () =>
      points
        .filter((p): p is GeoPoint & { lat: number; lng: number } => p.lat != null && p.lng != null)
        .map((p) => ({ point: p, lat: p.lat, lng: p.lng })),
    [points],
  );

  const center: [number, number] = plotted.length ? [plotted[0].lat, plotted[0].lng] : INDIA_CENTER;

  return (
    // `isolate relative z-0` gives the map its OWN stacking context. Leaflet assigns very high
    // z-indexes internally (panes 400, controls 1000); without an isolated context those escape
    // and render above page modals (the drill-down sheet). Containing them here is the root fix.
    <MapContainer
      center={center}
      zoom={plotted.length ? 11 : 5}
      scrollWheelZoom
      className="h-full w-full isolate relative z-0"
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={plotted.map((p) => ({ lat: p.lat, lng: p.lng }))} />

      {plotted.map(({ point, lat, lng }) => (
        <Marker
          key={point.siteId}
          position={[lat, lng]}
          icon={pinIcon(stageColor(point.furthestStage))}
          eventHandlers={onSelect ? { click: () => onSelect(point) } : undefined}
        >
          <Tooltip direction="top" offset={[0, -12]}>
            <span className="text-xs">
              <strong>{point.code}</strong> — {point.name}
              <br />
              {STAGE_LABELS[point.furthestStage] ?? point.furthestStage}
            </span>
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}
