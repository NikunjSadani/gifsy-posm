'use client';

/**
 * Ghost overlay for guided before/after capture. Renders a prior ("before") photo as a faint
 * (~30% opacity) layer over the live capture zone so the field user can align the "after" shot
 * to the same framing. A small toggle hides/shows the ghost.
 *
 * Meant to be dropped into a `position: relative` container (e.g. CameraCapture's empty capture
 * zone via its `overlay` prop). The ghost image is non-interactive; only the toggle is clickable.
 */

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface GhostOverlayProps {
  /** The "before" photo URL (e.g. mediaViewUrl(recceKey)). */
  src: string;
  /** Whether the ghost starts visible (default true). */
  defaultOn?: boolean;
}

export function GhostOverlay({ src, defaultOn = true }: GhostOverlayProps) {
  const [on, setOn] = useState(defaultOn);

  return (
    <>
      {on && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-30"
        />
      )}
      <button
        type="button"
        onClick={() => setOn((v) => !v)}
        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-xl bg-black/70 px-2.5 py-1.5 text-[11px] font-semibold text-white active:scale-95 transition-transform"
      >
        {on ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        {on ? 'Hide guide' : 'Show guide'}
      </button>
    </>
  );
}

export default GhostOverlay;
