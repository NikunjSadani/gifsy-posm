'use client';

/**
 * One installation in the audit queue — a clickable card showing the site, submitting vendor,
 * received time, POSM count, small before/after thumbnails and an at-a-glance integrity hint.
 */

import Link from 'next/link';
import { ChevronRight, Package, User, AlertTriangle, Clock } from 'lucide-react';
import { MediaImage } from './media-image';
import { formatRelativeTime } from '@/lib/utils';
import { hasIntegrityWarning, type QueueItem } from '@/lib/audit/api';

export function InstallRow({ item }: { item: QueueItem }) {
  const flagged = item.compare.filter((c) => hasIntegrityWarning(c)).length;
  const thumbs = item.compare.slice(0, 3);
  const extra = item.compare.length - thumbs.length;

  return (
    <Link
      href={`/audit/installations/${item.id}`}
      className="block bg-white rounded-2xl border border-gray-100 shadow-sm hover:border-[var(--brand-primary)] hover:shadow-md transition-all active:scale-[0.99]"
    >
      <div className="flex items-stretch gap-3 p-3">
        {/* Thumbnails */}
        <div className="flex gap-1 shrink-0">
          {thumbs.map((c) => (
            <MediaImage
              key={c.installPosmId}
              photo={c.installPhoto}
              alt={`${c.posmType.name} install thumbnail`}
              className="h-16 w-16 rounded-xl border border-gray-100"
            />
          ))}
          {extra > 0 && (
            <div className="h-16 w-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-xs font-semibold text-gray-500">
              +{extra}
            </div>
          )}
        </div>

        {/* Meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-gray-900 truncate">{item.site.name}</p>
            <span className="text-[11px] font-mono text-gray-400 shrink-0">{item.site.code}</span>
          </div>
          {item.site.town && <p className="text-xs text-gray-500 truncate">{item.site.town}</p>}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-600">
              <User className="h-3 w-3 text-gray-400" />
              {item.submittedBy?.name ?? 'Unknown vendor'}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-600">
              <Package className="h-3 w-3 text-gray-400" />
              {item.compare.length} Element{item.compare.length === 1 ? '' : 's'}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
              <Clock className="h-3 w-3 text-gray-400" />
              {formatRelativeTime(item.receivedAt)}
            </span>
          </div>

          {flagged > 0 && (
            <span className="inline-flex items-center gap-1 mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              {flagged} to check
            </span>
          )}
        </div>

        <div className="flex items-center">
          <ChevronRight className="h-5 w-5 text-gray-300" />
        </div>
      </div>
    </Link>
  );
}

export default InstallRow;
