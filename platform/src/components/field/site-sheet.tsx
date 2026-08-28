'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, Navigation, Phone, MapPin, Camera } from 'lucide-react';
import { StatusChip } from '@/components/field/status-chip';
import { directionsUrl, siteCoords, type Site } from '@/lib/field/sites';

/**
 * Bottom-sheet site detail — slides up over a scrim. Shows name / phone / address and two
 * actions: "Get directions" (a free Google Maps directions deep-link, no API key) and
 * "Start recce" (routes to the recce capture flow — stubbed for this slice).
 *
 * Directions are disabled when the site has no geotag (nothing to route to).
 */
export function SiteSheet({ site, onClose }: { site: Site | null; onClose: () => void }) {
  const router = useRouter();

  // Close on Escape.
  useEffect(() => {
    if (!site) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [site, onClose]);

  if (!site) return null;

  const dir = directionsUrl(site);
  const hasGeo = !!siteCoords(site);

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center" role="dialog" aria-modal="true">
      {/* Scrim */}
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 animate-[fadeIn_0.2s_ease-out]"
      />
      {/* Sheet */}
      <div className="relative w-full max-w-md bg-white rounded-t-3xl shadow-2xl p-5 pb-8 fade-in">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-gray-200" />
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center active:scale-90 transition-transform"
        >
          <X className="h-4 w-4 text-gray-600" />
        </button>

        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-mono font-semibold text-gray-500">{site.code}</span>
          <StatusChip status={site.status} />
        </div>
        <h2 className="text-lg font-bold text-gray-900 leading-tight">{site.name}</h2>

        <div className="mt-4 space-y-3 text-sm">
          <div className="flex items-start gap-3">
            <MapPin className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
            <span className="text-gray-700">
              {site.town || 'Town not recorded'}
              {site.rsCode && <span className="text-gray-400"> · RS {site.rsCode}</span>}
            </span>
          </div>
          <div className="flex items-start gap-3">
            <Phone className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
            {site.phone ? (
              <a href={`tel:${site.phone}`} className="text-[var(--brand-primary)] font-medium">
                {site.phone}
              </a>
            ) : (
              <span className="text-gray-400">No phone on record</span>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          {hasGeo && dir ? (
            <a
              href={dir}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 bg-white border-2 border-[var(--brand-primary)] text-[var(--brand-primary)] font-bold py-3.5 rounded-2xl active:scale-95 transition-transform"
            >
              <Navigation className="h-4 w-4" />
              Directions
            </a>
          ) : (
            <button
              disabled
              className="flex items-center justify-center gap-2 bg-gray-50 border-2 border-gray-100 text-gray-400 font-bold py-3.5 rounded-2xl cursor-not-allowed"
              title="This site has no location on record"
            >
              <Navigation className="h-4 w-4" />
              No location
            </button>
          )}
          <button
            onClick={() => router.push(`/field/recce/${site.id}`)}
            className="flex items-center justify-center gap-2 bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white font-bold py-3.5 rounded-2xl active:scale-95 transition-all"
          >
            <Camera className="h-4 w-4" />
            Start recce
          </button>
        </div>
      </div>
    </div>
  );
}

export default SiteSheet;
