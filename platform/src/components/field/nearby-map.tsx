'use client';

/**
 * Leaflet + OpenStreetMap map (free tiles, no API key). CLIENT-ONLY — `window`/Leaflet are
 * touched at module import, so the Nearby page must load this via `next/dynamic` with
 * `ssr:false`.
 *
 * Renders one colour-coded pin per geotagged site (green = active, gray = inactive) plus a
 * blue device-location dot. Tapping a pin calls `onSelect` so the page can open the shared
 * site sheet. Sites without a geotag are simply not plotted.
 */

import { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { siteCoords, statusPinColor, type Site } from '@/lib/field/sites';

/** India centroid — fallback centre before/without a device fix. */
const INDIA_CENTER: [number, number] = [22.5937, 78.9629];

function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'posm-pin',
    html: `<span style="
      display:block;width:18px;height:18px;border-radius:50% 50% 50% 0;
      background:${color};transform:rotate(-45deg);
      border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  });
}

/** Imperatively recentres the map when the device location resolves. */
function Recenter({ center, zoom }: { center: [number, number] | null; zoom: number }) {
  const map = useMap();
  useMemo(() => {
    if (center) map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

export interface NearbyMapProps {
  sites: Site[];
  userLocation: { lat: number; lng: number } | null;
  onSelect: (site: Site) => void;
}

export default function NearbyMap({ sites, userLocation, onSelect }: NearbyMapProps) {
  const plotted = useMemo(
    () => sites.map((s) => ({ site: s, c: siteCoords(s) })).filter((x): x is { site: Site; c: { lat: number; lng: number } } => !!x.c),
    [sites],
  );

  const center: [number, number] = userLocation
    ? [userLocation.lat, userLocation.lng]
    : plotted.length
      ? [plotted[0].c.lat, plotted[0].c.lng]
      : INDIA_CENTER;

  return (
    <MapContainer
      center={center}
      zoom={userLocation ? 14 : plotted.length ? 12 : 5}
      scrollWheelZoom
      zoomControl={false}
      className="h-full w-full"
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Recenter center={userLocation ? [userLocation.lat, userLocation.lng] : null} zoom={14} />

      {userLocation && (
        <Circle
          center={[userLocation.lat, userLocation.lng]}
          radius={40}
          pathOptions={{ color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.9, weight: 2 }}
        />
      )}

      {plotted.map(({ site, c }) => (
        <Marker
          key={site.id}
          position={[c.lat, c.lng]}
          icon={pinIcon(statusPinColor(site.status))}
          eventHandlers={{ click: () => onSelect(site) }}
        />
      ))}
    </MapContainer>
  );
}
