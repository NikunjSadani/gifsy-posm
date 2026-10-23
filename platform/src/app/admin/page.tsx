'use client';

/**
 * Masters overview — live counts + quick links into each master. Each card loads its own
 * count independently so one slow/failing list never blocks the others.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Users, Tags, MapPin, ArrowRight } from 'lucide-react';
import { vendorsApi, usersApi, posmTypesApi, sitesApi } from '@/lib/admin/api';
import { Spinner } from '@/components/ui/spinner';

interface CardDef {
  href: string;
  label: string;
  description: string;
  icon: typeof Building2;
  load: () => Promise<number | null>;
}

const CARDS: CardDef[] = [
  {
    href: '/admin/vendors',
    label: 'Vendors',
    description: 'Fleets servicing outlets',
    icon: Building2,
    load: async () => {
      const r = await vendorsApi.list();
      return r.success ? r.data.length : null;
    },
  },
  {
    href: '/admin/users',
    label: 'Users',
    description: 'Admins, ASMs, auditors & vendor logins',
    icon: Users,
    load: async () => {
      const r = await usersApi.list();
      return r.success ? r.data.length : null;
    },
  },
  {
    href: '/admin/posm-types',
    label: 'Element Types',
    description: 'Element catalogue',
    icon: Tags,
    load: async () => {
      const r = await posmTypesApi.list();
      return r.success ? r.data.length : null;
    },
  },
  {
    href: '/admin/sites',
    label: 'Outlets',
    description: 'Retail outlets (incl. bulk upload)',
    icon: MapPin,
    load: async () => {
      const r = await sitesApi.list({ limit: 1 });
      return r.success ? r.data.total : null;
    },
  },
];

function CountCard({ card }: { card: CardDef }) {
  const [count, setCount] = useState<number | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const Icon = card.icon;

  useEffect(() => {
    let cancelled = false;
    card.load()
      .then((n) => {
        if (cancelled) return;
        if (n === null) {
          setState('error');
        } else {
          setCount(n);
          setState('ok');
        }
      })
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
    };
  }, [card]);

  return (
    <Link
      href={card.href}
      className="group rounded-2xl border border-gray-200 bg-white p-5 hover:border-[var(--brand-primary)]/40 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between">
        <div className="p-2.5 rounded-xl bg-[var(--brand-primary-light)] text-[var(--brand-primary)]">
          <Icon className="h-5 w-5" />
        </div>
        <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-[var(--brand-primary)] transition-colors" />
      </div>
      <div className="mt-4">
        {state === 'loading' ? (
          <Spinner size="sm" />
        ) : state === 'error' ? (
          <p className="text-sm text-gray-400">—</p>
        ) : (
          <p className="text-3xl font-bold text-gray-900">{count}</p>
        )}
        <p className="mt-1 text-sm font-semibold text-gray-800">{card.label}</p>
        <p className="text-xs text-gray-500">{card.description}</p>
      </div>
    </Link>
  );
}

export default function AdminOverviewPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Masters overview</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Manage the reference data your field programme runs on.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {CARDS.map((c) => (
          <CountCard key={c.href} card={c} />
        ))}
      </div>
    </div>
  );
}
