'use client';

/**
 * ElementBoxPlacer — the recce "mark where the Element goes" step, as an ASPECT-CORRECT box.
 *
 * Instead of free-drawing a rectangle, the field exec is handed ONE box pre-shaped to the element's
 * real-world width:height (the dimensions they just entered, in feet). They DRAG it to position and
 * DRAG the corner grip to resize — but the aspect ratio stays LOCKED, so the box always represents
 * the element's true footprint, never an arbitrary rectangle. The box seeds at a sensible default
 * size (centered, ~half the photo's constraining dimension): big enough to read, small enough to move.
 *
 * It is an aspect-correct PLANNING marker on a 2D photo, NOT a to-scale measurement — the copy stays
 * honest about that. On Done it hands back a standard single-rect `RecceMarkup` (the same contract the
 * backend stores and the review/audit overlays render), so nothing downstream changes.
 *
 * Coordinates are normalised 0..1 to the image CONTENT box (the `<img>` is `block w-full h-auto`, so a
 * pointer mapped against its `getBoundingClientRect()` lands on the same content pixel the normalised
 * coord resolves to). The on-screen aspect folds in the image's own pixel aspect — see `normAspectFor`.
 */

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, X, RotateCcw, Move } from 'lucide-react';
import {
  buildMarkup,
  clamp01,
  defaultElementBox,
  squareElementBox,
  moveElementBox,
  resizeElementBox,
  normAspectFor,
  rectToPercentStyle,
  type MarkupRect,
  type RecceMarkup,
} from '@/lib/markup';
import { useFocusTrap } from '@/components/audit/use-focus-trap';

interface ElementBoxPlacerProps {
  imageUrl: string;
  /**
   * Real-world element width & height (feet) — fix the box's locked aspect + the on-box label.
   * Ignored in {@link square} mode (UNIT elements carry no dimensions).
   */
  width?: number;
  height?: number;
  /**
   * UNIT mode: the box is a SQUARE (1:1 on-screen), aspect-locked to square (movable + resizable,
   * always staying square), with NO real-world W×H label — the element has no footprint dimensions.
   * When false/undefined the box is shaped from `width`×`height` (DIMENSION mode).
   */
  square?: boolean;
  initial?: RecceMarkup | null;
  onSave: (markup: RecceMarkup | null) => void;
  onCancel: () => void;
}

/** Pull the first rect out of an existing markup (edit re-open) — else null to seed a default. */
function firstRect(m: RecceMarkup | null | undefined): MarkupRect | null {
  const s = m?.shapes.find((sh) => sh.type === 'rect');
  return s && s.type === 'rect' ? s : null;
}

export function ElementBoxPlacer({ imageUrl, width, height, square, initial, onSave, onCancel }: ElementBoxPlacerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // The placed box, normalised 0..1. null until the image has measured + seeded.
  const [rect, setRect] = useState<MarkupRect | null>(null);
  // Active drag: move the whole box, or resize via the corner grip. null = idle.
  const drag = useRef<{ mode: 'move' | 'resize'; last: { x: number; y: number } } | null>(null);

  // UNIT → a 1:1 locked-square box; DIMENSION → the element's real-world width:height.
  const realAspect = square ? 1 : height != null && height > 0 && width != null ? width / height : 1;
  // The seed shape: a square for UNIT, else the W×H-aspect footprint box.
  const seedBox = (imgW: number, imgH: number) =>
    square ? squareElementBox(imgW, imgH) : defaultElementBox(realAspect, imgW, imgH);
  useFocusTrap(true, containerRef);

  /** Displayed image size (px) + its left/top — the mapping frame for pointer ↔ normalised. */
  const imgBox = () => {
    const el = imgRef.current;
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0 ? b : null;
  };

  const toNorm = (e: ReactPointerEvent): { x: number; y: number } | null => {
    const b = imgBox();
    if (!b) return null;
    return { x: clamp01((e.clientX - b.left) / b.width), y: clamp01((e.clientY - b.top) / b.height) };
  };

  /** Seed the default aspect box once the image has a measurable size (idempotent). */
  const onImgLoad = () => {
    const b = imgBox();
    if (!b) return;
    setRect((prev) => prev ?? firstRect(initial) ?? seedBox(b.width, b.height));
  };

  const reset = () => {
    const b = imgBox();
    if (b) setRect(seedBox(b.width, b.height));
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (!rect) return;
    const p = toNorm(e);
    if (!p) return;
    const isGrip = (e.target as HTMLElement)?.dataset?.grip === '1';
    const inside = p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
    if (!isGrip && !inside) return; // a tap outside the box does nothing (prevents accidental jumps)
    e.preventDefault();
    // Start the drag BEFORE capturing: setPointerCapture can throw for a non-active pointer, and
    // the drag must still work if it does (capture only keeps events flowing once the finger leaves
    // the box — nice-to-have, not required).
    drag.current = { mode: isGrip ? 'resize' : 'move', last: p };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* non-active pointer (e.g. synthetic) — ignore; drag still tracks via bubbling moves */
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !rect) return;
    const p = toNorm(e);
    const b = imgBox();
    if (!p || !b) return;
    if (d.mode === 'move') {
      // Capture the delta from the LAST pointer position BEFORE advancing `d.last`. The setRect
      // updater runs in React's render phase — AFTER this handler returns — so if it read `d.last`
      // itself, `d.last` would already equal `p` and every delta would collapse to zero (the box
      // would never move on a real pointer drag). Freezing dx/dy here keeps the updater pure.
      const dx = p.x - d.last.x;
      const dy = p.y - d.last.y;
      d.last = p;
      setRect((r) => (r ? moveElementBox(r, dx, dy) : r));
    } else {
      const na = normAspectFor(realAspect, b.width, b.height);
      setRect((r) => (r ? resizeElementBox(r, na, p.x, p.y) : r));
    }
  };

  const endDrag = (e: ReactPointerEvent) => {
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const done = () => onSave(rect ? buildMarkup([rect]) : null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  };

  // DIMENSION: the real-world footprint label. UNIT: no dimensions, so no W×H label.
  const dimLabel = square || width == null || height == null ? null : `${width} × ${height} ft`;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Position the Element box on the photo"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[85] flex flex-col bg-black outline-none"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-4 pb-3 text-white"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Move className="h-4 w-4 text-white/70" />
          Place the Element box
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close without saving"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-white active:scale-95 transition-transform"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Placement surface */}
      <div className="flex-1 overflow-auto overscroll-contain">
        <div className="flex min-h-full items-center justify-center px-3 py-3">
          <div
            className="relative w-full touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Recce photo to mark"
              draggable={false}
              onLoad={onImgLoad}
              className="block h-auto w-full rounded-xl"
            />
            {rect && (
              <div
                className="absolute rounded-sm border-2"
                style={{
                  ...rectToPercentStyle(rect),
                  borderColor: 'var(--brand-primary)',
                  backgroundColor: 'color-mix(in srgb, var(--brand-primary) 18%, transparent)',
                  touchAction: 'none',
                }}
              >
                {/* Real-world dimension label — honest: this is the element's footprint shape.
                    UNIT elements have no dimensions, so the label is omitted. */}
                {dimLabel && (
                  <span className="absolute -top-6 left-0 whitespace-nowrap rounded bg-[var(--brand-primary)] px-1.5 py-0.5 text-[11px] font-bold text-white shadow">
                    {dimLabel}
                  </span>
                )}
                {/* Corner resize grip (aspect-locked). Oversized hit area for touch. */}
                <span
                  data-grip="1"
                  aria-hidden="true"
                  className="absolute -bottom-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[var(--brand-primary)] shadow"
                >
                  <span data-grip="1" className="h-2 w-2 rounded-full bg-white" />
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Status / honesty note */}
      <div className="min-h-[2.25rem] px-4 text-center text-xs text-white/70">
        {dimLabel ? (
          <>
            Drag the box to where the <span className="font-semibold text-white/90">{dimLabel}</span> Element
            will go, and drag the corner to size it. The box keeps the element&apos;s shape — it marks the
            spot, it isn&apos;t a to-scale measurement.
          </>
        ) : (
          <>
            Drag the box to where the Element will go, and drag the corner to size it. The box marks the
            spot — it isn&apos;t a to-scale measurement.
          </>
        )}
      </div>

      {/* Controls */}
      <div
        className="grid grid-cols-3 gap-2 border-t border-white/10 px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
      >
        <button
          type="button"
          onClick={reset}
          className="flex flex-col items-center justify-center gap-1 rounded-xl bg-white/10 py-3 text-xs font-semibold text-white active:scale-95 transition-transform"
        >
          <RotateCcw className="h-5 w-5" /> Reset
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex flex-col items-center justify-center gap-1 rounded-xl bg-white/10 py-3 text-xs font-semibold text-white active:scale-95 transition-transform"
        >
          <X className="h-5 w-5" /> Cancel
        </button>
        <button
          type="button"
          onClick={done}
          disabled={!rect}
          className="flex flex-col items-center justify-center gap-1 rounded-xl bg-[var(--brand-primary)] py-3 text-xs font-bold text-white active:scale-95 transition-transform hover:bg-[var(--brand-primary-dark)] disabled:opacity-40"
        >
          <Check className="h-5 w-5" /> Done
        </button>
      </div>
    </div>
  );
}

export default ElementBoxPlacer;
