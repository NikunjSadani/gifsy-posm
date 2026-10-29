'use client';

/**
 * Nearby — a Leaflet/OpenStreetMap map of the vendor's geotagged sites, colour-coded by
 * status, centred on the device location. Tapping a pin opens the shared site sheet. The map
 * is loaded client-side only (`ssr:false`) since Leaflet needs `window`.
 */

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { LocateFixed, Loader2 } from 'lucide-react';
import { SiteSheet } from '@/components/field/site-sheet';
import { fetchSites, siteCoords, type Site } from '@/lib/field/sites';

const NearbyMap = dynamic(() => import('@/components/field/nearby-map'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-gray-100">
      <Loader2 className="h-6 w-6 animate-spin text-[var(--brand-primary)]" />
    </div>
  ),
});

type GeoState = 'idle' | 'locating' | 'ok' | 'denied' | 'unsupported';

export default function NearbyPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selected, setSelected] = useState<Site | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<GeoState>('idle');
  // Bumped on each successful fix so the map recentres on a fresh locate, but not on a plain
  // re-render (e.g. selecting a pin), which would otherwise yank the map back.
  const [fixNonce, setFixNonce] = useState(0);

  useEffect(() => {
    fetchSites({ limit: 200 }).then((res) => {
      if (res.success) setSites(res.data.sites);
    });
  }, []);

  const locate = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoState('unsupported');
      return;
    }
    setGeoState('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setFixNonce((n) => n + 1);
        setGeoState('ok');
      },
      () => setGeoState('denied'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  };

  // Attempt a device fix on first mount.
  useEffect(() => {
    locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const geoTaggedCount = useMemo(() => sites.filter((s) => siteCoords(s)).length, [sites]);

  return (
    <div className="relative h-[calc(100vh_-_8rem)]">
      <NearbyMap sites={sites} userLocation={userLocation} onSelect={setSelected} selectedId={selected?.id ?? null} recenterKey={fixNonce} />

      {/* Recenter / locate control */}
      <button
        onClick={locate}
        aria-label="Center on my location"
        className="absolute right-4 top-4 z-[500] h-11 w-11 rounded-2xl bg-white shadow-lg border border-gray-200 flex items-center justify-center active:scale-95 transition-transform"
      >
        {geoState === 'locating' ? (
          <Loader2 className="h-5 w-5 animate-spin text-[var(--brand-primary)]" />
        ) : (
          <LocateFixed className="h-5 w-5 text-[var(--brand-primary)]" />
        )}
      </button>

      {/* Status banner */}
      <div className="absolute left-4 top-4 z-[500] max-w-[calc(100%-5rem)]">
        <div className="bg-white/95 backdrop-blur rounded-2xl shadow-lg border border-gray-100 px-3 py-2">
          <p className="text-xs font-semibold text-gray-800">{geoTaggedCount} outlets on map</p>
          {geoState === 'denied' && (
            <p className="text-[11px] text-amber-600 mt-0.5">Location off — showing outlets only</p>
          )}
          {geoState === 'unsupported' && (
            <p className="text-[11px] text-amber-600 mt-0.5">Location not supported on this device</p>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="absolute left-4 bottom-4 z-[500] max-w-[calc(100%-2rem)] bg-white/95 backdrop-blur rounded-2xl shadow-lg border border-gray-100 px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#16a34a' }} />
          Active
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#9ca3af' }} />
          Inactive
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#E3000F' }} />
          Selected
        </span>
      </div>

      <SiteSheet site={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
