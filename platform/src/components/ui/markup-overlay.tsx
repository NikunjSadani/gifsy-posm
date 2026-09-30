'use client';

/**
 * Reviewer-side rendering of a recce photo's MARKUP — the field executive's on-image
 * annotation marking WHERE the POSM install is proposed. Consumed by the ASM (recce review)
 * and the Auditor (install before/after) to SEE the proposed placement over the recce photo.
 *
 * The prop is intentionally `unknown`: `parseMarkup` (the shared, defensive contract in
 * `@/lib/markup`) is the SINGLE validation point, so a legacy/garbage value degrades to no
 * overlay rather than a crash. When there is nothing meaningful to draw, this renders null.
 *
 * ALIGNMENT: the coordinates are normalised 0..1 to the image's CONTENT box, so this layer
 * MUST be dropped inside a `relative` wrapper that is exactly the image's rendered box (e.g.
 * an `<img className="block w-full h-auto">` and this overlay as its sibling). If the image
 * were letterboxed via `object-contain` inside a taller fixed-height box, the percentages
 * would map to the padded box and misalign — see the callers for how the box is guaranteed.
 */

import { parseMarkup, rectToPercentStyle } from '@/lib/markup';

export function MarkupOverlay({ markup }: { markup: unknown }) {
  const parsed = parseMarkup(markup);
  if (!parsed) return null;

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {parsed.shapes.map((shape, i) => {
        const style = rectToPercentStyle(shape);
        return (
          <div
            key={i}
            className="absolute rounded-sm border-2 border-[var(--brand-primary)] bg-[var(--brand-primary)]/15"
            style={style}
          >
            <span className="absolute top-0 left-0 bg-[var(--brand-primary)] text-white text-[9px] font-bold leading-none px-1 py-0.5 rounded-br-sm rounded-tl-[1px]">
              POSM
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default MarkupOverlay;
