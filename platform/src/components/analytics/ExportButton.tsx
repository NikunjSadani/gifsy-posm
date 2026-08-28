'use client';

/**
 * Excel export trigger. The download is a same-origin `<a href="/api/analytics/export">` so
 * the edge proxy injects the auth cookie→Bearer and the browser streams the attachment — we
 * NEVER attach an Authorization header manually (an anchor can't carry one anyway). Rendered
 * as an anchor styled like a button; `download` hints a filename.
 */

import { Download } from 'lucide-react';
import { exportUrl, type AnalyticsStage } from '@/lib/analytics/api';

export function ExportButton({ stage, className = '' }: { stage?: AnalyticsStage; className?: string }) {
  return (
    <a
      href={exportUrl({ stage })}
      download
      className={`inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white text-sm font-semibold px-4 py-2.5 active:scale-95 transition-all ${className}`}
    >
      <Download className="h-4 w-4" />
      Export to Excel
    </a>
  );
}

export default ExportButton;
