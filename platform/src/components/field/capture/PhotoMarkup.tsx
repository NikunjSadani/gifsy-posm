'use client';

/**
 * PhotoMarkup — full-screen annotator the field executive uses AFTER capturing a recce photo to
 * mark WHERE the POSM installation is proposed. The user drags highlight rectangle(s) on the
 * photo; on Done we hand back a normalised `RecceMarkup` (or null when nothing meaningful was
 * drawn) built via the shared `buildMarkup` contract — the same shape the backend stores and the
 * review/audit overlays render.
 *
 * Coordinates are normalised 0..1 relative to the IMAGE's own box. The `<img>` is the sizing
 * element (`block w-full h-auto` inside a `relative` wrapper) so the rendered picture fills the
 * width at its natural aspect with NO object-contain letterboxing — a pointer position mapped
 * against the img's `getBoundingClientRect()` therefore lands on the same content pixel that the
 * normalised coord will later resolve to on the stored original. Pointer events (not mouse/touch)
 * drive the drawing so it works with a finger and a mouse alike.
 */

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Undo2, Eraser, Check, X } from 'lucide-react';
import {
  buildMarkup,
  clamp01,
  rectToPercentStyle,
  MARKUP_MAX_SHAPES,
  MARKUP_MIN_SIDE,
  type MarkupRect,
  type RecceMarkup,
} from '@/lib/markup';
import { useFocusTrap } from '@/components/audit/use-focus-trap';

interface PhotoMarkupProps {
  /** The photo to annotate (an object-URL of the captured file, or the uploaded view URL). */
  imageUrl: string;
  /** Existing markup to edit, when reopening. */
  initial?: RecceMarkup | null;
  /** Called with the built markup (or null when nothing meaningful was drawn). */
  onSave: (markup: RecceMarkup | null) => void;
  /** Called when the user discards their changes. */
  onCancel: () => void;
}

/** Build a positive, normalised rect from two corner points in 0..1 image space. */
function rectFromCorners(sx: number, sy: number, cx: number, cy: number): MarkupRect {
  const x = Math.min(sx, cx);
  const y = Math.min(sy, cy);
  return { x, y, w: Math.abs(cx - sx), h: Math.abs(cy - sy) };
}

export function PhotoMarkup({ imageUrl, initial, onSave, onCancel }: PhotoMarkupProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [rects, setRects] = useState<MarkupRect[]>(() => initial?.shapes.slice(0, MARKUP_MAX_SHAPES) ?? []);
  // The in-progress rect while dragging (positive w/h), or null when idle.
  const [draft, setDraft] = useState<MarkupRect | null>(null);
  // Drag origin in 0..1 image space; also our "is dragging" flag.
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [atLimit, setAtLimit] = useState(false);

  const full = rects.length >= MARKUP_MAX_SHAPES;

  // Focus trap for the full-screen dialog; Escape cancels (see below).
  useFocusTrap(true, containerRef);

  /** Map a pointer event to a clamped 0..1 coordinate in the IMG's content box. */
  const toImageCoord = (e: ReactPointerEvent): { x: number; y: number } | null => {
    const el = imgRef.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return {
      x: clamp01((e.clientX - box.left) / box.width),
      y: clamp01((e.clientY - box.top) / box.height),
    };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return; // primary button / touch / pen only
    if (full) {
      setAtLimit(true);
      return;
    }
    const p = toImageCoord(e);
    if (!p) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    startRef.current = p;
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const start = startRef.current;
    if (!start) return;
    const p = toImageCoord(e);
    if (!p) return;
    setDraft(rectFromCorners(start.x, start.y, p.x, p.y));
  };

  const endDrag = (e: ReactPointerEvent) => {
    const start = startRef.current;
    if (!start) return;
    startRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    const p = toImageCoord(e);
    const finished = p ? rectFromCorners(start.x, start.y, p.x, p.y) : draft;
    setDraft(null);
    // Drop a stray tap (a rect below the deliberate-mark threshold) rather than commit a speck.
    if (!finished || finished.w < MARKUP_MIN_SIDE || finished.h < MARKUP_MIN_SIDE) return;
    setRects((prev) => {
      if (prev.length >= MARKUP_MAX_SHAPES) {
        setAtLimit(true);
        return prev;
      }
      const next = [...prev, finished];
      if (next.length >= MARKUP_MAX_SHAPES) setAtLimit(true);
      return next;
    });
  };

  const undo = () => {
    setAtLimit(false);
    setRects((prev) => prev.slice(0, -1));
  };
  const clear = () => {
    setAtLimit(false);
    setRects([]);
  };
  const done = () => onSave(buildMarkup(rects));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Mark the POSM area on the photo"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[85] flex flex-col bg-black outline-none"
    >
      {/* Header: hint + close */}
      <div
        className="flex items-center justify-between gap-3 px-4 pb-3 text-white"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <p className="min-w-0 flex-1 text-sm text-white/90">Drag to mark where the POSM will go.</p>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close without saving"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-white active:scale-95 transition-transform"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Drawing surface — scrollable so a tall photo fits; the img is the sizing element. */}
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
              alt="Recce photo to annotate"
              draggable={false}
              className="block h-auto w-full rounded-xl"
            />

            {/* Committed highlight rectangles. */}
            {rects.map((r, i) => (
              <div
                key={i}
                aria-hidden
                className="pointer-events-none absolute rounded-sm border-2"
                style={{
                  ...rectToPercentStyle(r),
                  borderColor: 'var(--brand-primary)',
                  backgroundColor: 'color-mix(in srgb, var(--brand-primary) 22%, transparent)',
                }}
              />
            ))}

            {/* In-progress rectangle while dragging. */}
            {draft && (
              <div
                aria-hidden
                className="pointer-events-none absolute rounded-sm border-2 border-dashed"
                style={{
                  ...rectToPercentStyle(draft),
                  borderColor: 'var(--brand-primary)',
                  backgroundColor: 'color-mix(in srgb, var(--brand-primary) 14%, transparent)',
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Status note */}
      <div className="min-h-[1.25rem] px-4 text-center text-xs text-white/70">
        {full || atLimit
          ? `Limit reached — up to ${MARKUP_MAX_SHAPES} areas.`
          : rects.length > 0
            ? `${rects.length} area${rects.length === 1 ? '' : 's'} marked.`
            : null}
      </div>

      {/* Controls */}
      <div
        className="grid grid-cols-4 gap-2 border-t border-white/10 px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
      >
        <button
          type="button"
          onClick={undo}
          disabled={rects.length === 0}
          className="flex flex-col items-center justify-center gap-1 rounded-xl bg-white/10 py-3 text-xs font-semibold text-white active:scale-95 transition-transform disabled:opacity-40"
        >
          <Undo2 className="h-5 w-5" />
          Undo
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={rects.length === 0}
          className="flex flex-col items-center justify-center gap-1 rounded-xl bg-white/10 py-3 text-xs font-semibold text-white active:scale-95 transition-transform disabled:opacity-40"
        >
          <Eraser className="h-5 w-5" />
          Clear
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex flex-col items-center justify-center gap-1 rounded-xl bg-white/10 py-3 text-xs font-semibold text-white active:scale-95 transition-transform"
        >
          <X className="h-5 w-5" />
          Cancel
        </button>
        <button
          type="button"
          onClick={done}
          className="flex flex-col items-center justify-center gap-1 rounded-xl bg-[var(--brand-primary)] py-3 text-xs font-bold text-white active:scale-95 transition-transform hover:bg-[var(--brand-primary-dark)]"
        >
          <Check className="h-5 w-5" />
          Done
        </button>
      </div>
    </div>
  );
}

export default PhotoMarkup;
