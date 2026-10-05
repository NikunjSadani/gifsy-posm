'use client';

/**
 * PhotoMarkup — full-screen annotator the field executive uses AFTER capturing a recce photo to
 * mark WHERE the POSM installation is proposed. Two tools: a RECTANGLE box (drag corner-to-corner)
 * and FREEHAND (drag to trace a line). On Done we hand back a normalised `RecceMarkup` (or null
 * when nothing meaningful was drawn) via the shared `buildMarkup` contract — the same shape the
 * backend stores and the review/audit overlays render.
 *
 * Coordinates are normalised 0..1 relative to the IMAGE's own box. The `<img>` is the sizing
 * element (`block w-full h-auto` inside a `relative` wrapper) so the rendered picture fills the
 * width at its natural aspect with NO object-contain letterboxing — a pointer position mapped
 * against the img's `getBoundingClientRect()` lands on the same content pixel the normalised coord
 * later resolves to. Committed shapes render in an SVG (viewBox 0..100, preserveAspectRatio none)
 * over the image, matching the reviewer overlay. Pointer events drive drawing (finger + mouse).
 */

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Undo2, Eraser, Check, X, Square, PenLine } from 'lucide-react';
import {
  buildMarkup,
  clamp01,
  pathToSvgPoints,
  MARKUP_MAX_SHAPES,
  MARKUP_MIN_SIDE,
  MARKUP_MAX_POINTS,
  type MarkupPoint,
  type MarkupRect,
  type MarkupPath,
  type MarkupShape,
  type RecceMarkup,
} from '@/lib/markup';
import { useFocusTrap } from '@/components/audit/use-focus-trap';

type Tool = 'rect' | 'path';

interface PhotoMarkupProps {
  imageUrl: string;
  initial?: RecceMarkup | null;
  onSave: (markup: RecceMarkup | null) => void;
  onCancel: () => void;
}

/** A positive, normalised rect from two corner points in 0..1 image space. */
function rectFromCorners(sx: number, sy: number, cx: number, cy: number): MarkupRect {
  return { type: 'rect', x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) };
}

/** Max span of a point set in x/y — used to drop a negligible freehand scribble. */
function pathExtent(points: MarkupPoint[]): number {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return Math.max(maxX - minX, maxY - minY);
}

export function PhotoMarkup({ imageUrl, initial, onSave, onCancel }: PhotoMarkupProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [tool, setTool] = useState<Tool>('rect');
  const [shapes, setShapes] = useState<MarkupShape[]>(() => initial?.shapes.slice(0, MARKUP_MAX_SHAPES) ?? []);
  const [draft, setDraft] = useState<MarkupShape | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null); // rect origin / "is drawing"
  const pointsRef = useRef<MarkupPoint[]>([]); // freehand accumulator
  const [atLimit, setAtLimit] = useState(false);

  const full = shapes.length >= MARKUP_MAX_SHAPES;
  useFocusTrap(true, containerRef);

  const toImageCoord = (e: ReactPointerEvent): MarkupPoint | null => {
    const el = imgRef.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return { x: clamp01((e.clientX - box.left) / box.width), y: clamp01((e.clientY - box.top) / box.height) };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (full) { setAtLimit(true); return; }
    const p = toImageCoord(e);
    if (!p) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    startRef.current = p;
    if (tool === 'rect') {
      setDraft({ type: 'rect', x: p.x, y: p.y, w: 0, h: 0 });
    } else {
      pointsRef.current = [p];
      setDraft({ type: 'path', points: [p] });
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const start = startRef.current;
    if (!start) return;
    const p = toImageCoord(e);
    if (!p) return;
    if (tool === 'rect') {
      setDraft(rectFromCorners(start.x, start.y, p.x, p.y));
    } else {
      const pts = pointsRef.current;
      const last = pts[pts.length - 1];
      // Skip near-duplicate points; cap the live buffer (Done downsamples anyway).
      if ((!last || Math.abs(last.x - p.x) > 0.002 || Math.abs(last.y - p.y) > 0.002) && pts.length < MARKUP_MAX_POINTS) {
        pts.push(p);
        setDraft({ type: 'path', points: [...pts] });
      }
    }
  };

  const endDrag = (e: ReactPointerEvent) => {
    const start = startRef.current;
    if (!start) return;
    startRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);

    let finished: MarkupShape | null = null;
    if (tool === 'rect') {
      const p = toImageCoord(e);
      const r = p ? rectFromCorners(start.x, start.y, p.x, p.y) : (draft as MarkupRect | null);
      if (r && r.w >= MARKUP_MIN_SIDE && r.h >= MARKUP_MIN_SIDE) finished = r;
    } else {
      const pts = pointsRef.current;
      pointsRef.current = [];
      if (pts.length >= 2 && pathExtent(pts) >= MARKUP_MIN_SIDE) finished = { type: 'path', points: pts } as MarkupPath;
    }
    setDraft(null);
    if (!finished) return; // stray tap / speck → dropped
    setShapes((prev) => {
      if (prev.length >= MARKUP_MAX_SHAPES) { setAtLimit(true); return prev; }
      const next = [...prev, finished!];
      if (next.length >= MARKUP_MAX_SHAPES) setAtLimit(true);
      return next;
    });
  };

  const undo = () => { setAtLimit(false); setShapes((p) => p.slice(0, -1)); };
  const clear = () => { setAtLimit(false); setShapes([]); };
  const done = () => onSave(buildMarkup(shapes));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
  };

  const renderShape = (s: MarkupShape, i: number, dashed = false) =>
    s.type === 'rect' ? (
      <rect
        key={i} x={s.x * 100} y={s.y * 100} width={s.w * 100} height={s.h * 100} rx={1}
        strokeWidth={2} strokeDasharray={dashed ? '4 3' : undefined} vectorEffect="non-scaling-stroke"
        style={{ fill: 'var(--brand-primary)', fillOpacity: dashed ? 0.1 : 0.2, stroke: 'var(--brand-primary)' }}
      />
    ) : (
      <polyline
        key={i} points={pathToSvgPoints(s)} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"
        strokeDasharray={dashed ? '4 3' : undefined} vectorEffect="non-scaling-stroke"
        style={{ fill: 'none', stroke: 'var(--brand-primary)' }}
      />
    );

  const toolBtn = (t: Tool, Icon: typeof Square, label: string) => (
    <button
      type="button"
      onClick={() => setTool(t)}
      aria-pressed={tool === t}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
        tool === t ? 'bg-white text-gray-900' : 'bg-white/10 text-white/80'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Mark the Element area on the photo"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[85] flex flex-col bg-black outline-none"
    >
      {/* Header: tool toggle + close */}
      <div
        className="flex items-center justify-between gap-3 px-4 pb-3 text-white"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="flex items-center gap-2">
          {toolBtn('rect', Square, 'Box')}
          {toolBtn('path', PenLine, 'Freehand')}
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

      {/* Drawing surface */}
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
            <img ref={imgRef} src={imageUrl} alt="Recce photo to annotate" draggable={false} className="block h-auto w-full rounded-xl" />
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {shapes.map((s, i) => renderShape(s, i))}
              {draft && renderShape(draft, -1, true)}
            </svg>
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="min-h-[1.25rem] px-4 text-center text-xs text-white/70">
        {full || atLimit
          ? `Limit reached — up to ${MARKUP_MAX_SHAPES} marks.`
          : shapes.length > 0
            ? `${shapes.length} mark${shapes.length === 1 ? '' : 's'} · ${tool === 'rect' ? 'drag a box' : 'trace a line'}`
            : tool === 'rect'
              ? 'Drag a box around where the Element will go.'
              : 'Drag to draw around where the Element will go.'}
      </div>

      {/* Controls */}
      <div
        className="grid grid-cols-4 gap-2 border-t border-white/10 px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
      >
        <button type="button" onClick={undo} disabled={shapes.length === 0}
          className="flex flex-col items-center justify-center gap-1 rounded-xl bg-white/10 py-3 text-xs font-semibold text-white active:scale-95 transition-transform disabled:opacity-40">
          <Undo2 className="h-5 w-5" /> Undo
        </button>
        <button type="button" onClick={clear} disabled={shapes.length === 0}
          className="flex flex-col items-center justify-center gap-1 rounded-xl bg-white/10 py-3 text-xs font-semibold text-white active:scale-95 transition-transform disabled:opacity-40">
          <Eraser className="h-5 w-5" /> Clear
        </button>
        <button type="button" onClick={onCancel}
          className="flex flex-col items-center justify-center gap-1 rounded-xl bg-white/10 py-3 text-xs font-semibold text-white active:scale-95 transition-transform">
          <X className="h-5 w-5" /> Cancel
        </button>
        <button type="button" onClick={done}
          className="flex flex-col items-center justify-center gap-1 rounded-xl bg-[var(--brand-primary)] py-3 text-xs font-bold text-white active:scale-95 transition-transform hover:bg-[var(--brand-primary-dark)]">
          <Check className="h-5 w-5" /> Done
        </button>
      </div>
    </div>
  );
}

export default PhotoMarkup;
