'use client';

/**
 * Reviewer-side rendering of a recce photo's MARKUP — the field executive's on-image annotation
 * marking WHERE the POSM install is proposed. Consumed by the ASM (recce review) and the Auditor
 * (install before/after) to SEE the proposed placement over the recce photo. Renders both shape
 * tools: rectangle boxes and freehand paths.
 *
 * The prop is intentionally `unknown`: `parseMarkup` (the shared, defensive contract in
 * `@/lib/markup`) is the SINGLE validation point, so a legacy/garbage value degrades to no overlay
 * rather than a crash. Renders null when there is nothing meaningful to draw.
 *
 * Rendered as ONE SVG with `viewBox="0 0 100 100" preserveAspectRatio="none"` so the 0..1
 * (→0..100) coordinates stretch to fill the image box exactly; `vectorEffect="non-scaling-stroke"`
 * keeps the outline a constant on-screen width regardless of that non-uniform scale. ALIGNMENT: it
 * must be dropped inside a `relative` wrapper that is exactly the image's rendered box (e.g. an
 * `<img className="block w-full h-auto">` with this overlay as its sibling) — see the callers.
 */

import { parseMarkup, pathToSvgPoints } from '@/lib/markup';

export function MarkupOverlay({ markup }: { markup: unknown }) {
  const parsed = parseMarkup(markup);
  if (!parsed) return null;

  const stroke = { stroke: 'var(--brand-primary)' } as const;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {parsed.shapes.map((s, i) =>
        s.type === 'rect' ? (
          <rect
            key={i}
            x={s.x * 100}
            y={s.y * 100}
            width={s.w * 100}
            height={s.h * 100}
            rx={1}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            style={{ fill: 'var(--brand-primary)', fillOpacity: 0.15, ...stroke }}
          />
        ) : (
          <polyline
            key={i}
            points={pathToSvgPoints(s)}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{ fill: 'none', ...stroke }}
          />
        ),
      )}
    </svg>
  );
}

export default MarkupOverlay;
