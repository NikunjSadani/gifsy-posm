'use client';

/**
 * Leaflet + OpenStreetMap map (free tiles, no API key). CLIENT-ONLY — `window`/Leaflet are
 * touched at module import, so the Nearby page must load this via `next/dynamic` with
 * `ssr:false`.
 *
 * Renders one colour-coded pin per geotagged site (green = active, gray = inactive) plus a
 * blue device-location dot and a faint 1 km range ring around it. Tapping a pin calls
 * `onSelect` so the page can open the shared site sheet, and the tapped pin is highlighted
 * (brand red, enlarged) so the rep can see which outlet is open. Sites without a geotag are
 * simply not plotted.
 */

import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { siteCoords, statusPinColor, type Site } from '@/lib/field/sites';

/** India centroid — fallback centre before/without a device fix. */
const INDIA_CENTER: [number, number] = [22.5937, 78.9629];

/** The 1 km "how far outlets are from me" range ring around the device location. */
const RANGE_RING_METERS = 1000;
/** Highlight colour for the currently-selected pin — mirrors --brand-primary (#E3000F), hard-coded
 *  because a Leaflet DivIcon's inline style can't reliably resolve a CSS custom property. */
const SELECTED_PIN_COLOR = '#E3000F';

function pinIcon(color: string, selected = false): L.DivIcon {
  // The selected pin is enlarged + ringed so it reads as "the one you tapped" at a glance.
  const size = selected ? 26 : 18;
  const border = selected ? '3px solid #fff' : '2px solid #fff';
  const shadow = selected ? '0 2px 8px rgba(0,0,0,0.5)' : '0 1px 3px rgba(0,0,0,0.4)';
  return L.divIcon({
    className: 'posm-pin',
    html: `<span style="
      display:block;width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;
      background:${color};transform:rotate(-45deg);
      border:${border};box-shadow:${shadow};"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
  });
}

/**
 * Imperatively recentres the map ONLY when a NEW device fix arrives (keyed on `trigger`), not on
 * every render. The map is otherwise the user's to pan/zoom — re-running setView on each render
 * (e.g. when a pin is selected) would yank the map back and throw the just-tapped pin out of view.
 */
function Recenter({ center, zoom, trigger }: { center: [number, number] | null; zoom: number; trigger: number }) {
  const map = useMap();
  const lastTrigger = useRef<number | null>(null);
  useEffect(() => {
    if (!center) return;
    if (lastTrigger.current === trigger) return; // same fix — don't fight the user's pan/zoom
    lastTrigger.current = trigger;
    map.setView(center, zoom);
  }, [center, zoom, trigger, map]);
  return null;
}

export interface NearbyMapProps {
  sites: Site[];
  userLocation: { lat: number; lng: number } | null;
  onSelect: (site: Site) => void;
  /** The currently-open outlet (its pin is highlighted); null when the sheet is closed. */
  selectedId?: string | null;
  /** Increments on each successful device fix; the map recentres only when this changes. */
  recenterKey?: number;
}

export default function NearbyMap({ sites, userLocation, onSelect, selectedId, recenterKey = 0 }: NearbyMapProps) {
  const plotted = useMemo(
    () => sites.map((s) => ({ site: s, c: siteCoords(s) })).filter((x): x is { site: Site; c: { lat: number; lng: number } } => !!x.c),
    [sites],
  );

  // Share one icon instance per status (and one for the selection) instead of minting a fresh
  // DivIcon per marker on every render — otherwise react-leaflet re-runs setIcon on up to 200 pins
  // each time anything (a selection) re-renders. The selected pin gets the distinct highlight icon.
  const activeIcon = useMemo(() => pinIcon(statusPinColor('ACTIVE')), []);
  const inactiveIcon = useMemo(() => pinIcon(statusPinColor('INACTIVE')), []);
  const selectedIcon = useMemo(() => pinIcon(SELECTED_PIN_COLOR, true), []);

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
      <Recenter center={userLocation ? [userLocation.lat, userLocation.lng] : null} zoom={14} trigger={recenterKey} />

      {userLocation && (
        <>
          {/* Light 1 km range ring — how far the nearby outlets are from the rep. Dashed + faintly
              filled so it reads as a deliberate range guide, not a rendering artifact. Drawn first
              so it sits UNDER the device dot. */}
          <Circle
            center={[userLocation.lat, userLocation.lng]}
            radius={RANGE_RING_METERS}
            pathOptions={{ color: '#2563eb', weight: 1.5, opacity: 0.6, dashArray: '6 6', fillColor: '#3b82f6', fillOpacity: 0.08 }}
          />
          <Circle
            center={[userLocation.lat, userLocation.lng]}
            radius={40}
            pathOptions={{ color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.9, weight: 2 }}
          />
        </>
      )}

      {plotted.map(({ site, c }) => {
        const isSelected = !!selectedId && site.id === selectedId;
        return (
          <Marker
            key={site.id}
            position={[c.lat, c.lng]}
            icon={isSelected ? selectedIcon : site.status === 'ACTIVE' ? activeIcon : inactiveIcon}
            // Lift the selected pin above its neighbours so the highlight is never hidden.
            zIndexOffset={isSelected ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(site) }}
          />
        );
      })}
    </MapContainer>
  );
}
