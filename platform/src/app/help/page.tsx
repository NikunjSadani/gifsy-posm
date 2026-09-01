'use client';

/**
 * In-app Help / Guides — role-aware.
 *
 * Reads the current user's role from the (non-sensitive) stored user via `getStoredUser()`
 * in lib/auth-client, then renders that role's step-by-step guide from lib/help/content.
 * Admin roles (Client Admin / Platform Admin) additionally get a role switcher so they can
 * read any role's guide, since they support field teams across roles.
 *
 * This route lives at the top level (`/help`), a sibling of the role portals, so it is NOT
 * wrapped by their layouts — the page is therefore self-contained (own container + back link).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Compass,
  Info,
  LifeBuoy,
  MapPin,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { getStoredUser } from '@/lib/auth-client';
import {
  FIELD_NOTES,
  HELP_ROLES,
  ROLE_LABELS,
  getGuide,
  isHelpRole,
  type HelpRole,
  type RoleGuide,
} from '@/lib/help/content';

const ADMIN_ROLES: HelpRole[] = ['CLIENT_ADMIN', 'GIFSY_ADMIN'];

export default function HelpPage() {
  // role: undefined = still resolving; null = resolved but unknown/no session; string = known.
  const [role, setRole] = useState<string | null | undefined>(undefined);
  // The role whose guide is currently displayed (admins can switch this).
  const [viewRole, setViewRole] = useState<HelpRole | null>(null);

  useEffect(() => {
    const user = getStoredUser();
    const r = user?.role ?? null;
    setRole(r);
    if (isHelpRole(r)) setViewRole(r);
  }, []);

  const isAdmin = isHelpRole(role) && ADMIN_ROLES.includes(role);
  // The caller's OWN role (null if unknown) — used to gate the "go to my home" CTA so an admin
  // browsing another role's guide is never linked into a portal their token can't enter.
  const userRole: HelpRole | null = isHelpRole(role) ? role : null;
  const guide = viewRole ? getGuide(viewRole) : null;

  // Loading: role not yet resolved on the client.
  if (role === undefined) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-center px-4 py-24">
          <Spinner size="lg" />
          <p className="mt-4 text-sm text-gray-500">Loading your guide…</p>
        </div>
      </main>
    );
  }

  // Resolved, but the role is unknown or there is no session.
  if (!guide || !viewRole) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-md px-4 py-16">
          <Card>
            <CardContent className="flex flex-col items-center px-6 py-10 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100">
                <LifeBuoy className="h-7 w-7 text-gray-400" />
              </div>
              <h1 className="text-lg font-bold text-gray-900">Help &amp; Guides</h1>
              <p className="mt-2 text-sm text-gray-500">
                We couldn’t work out your role. Please sign in again, and your role-specific guide
                will appear here.
              </p>
              <Link
                href="/auth/login"
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-primary-dark)]"
              >
                Go to sign in
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  // Field roles get a tighter mobile column; admin/desktop roles get a wider canvas.
  const narrow = guide.showFieldNotes && !isAdmin;

  return (
    <main className="min-h-screen bg-gray-50">
      <div className={cn('mx-auto px-4 py-6', narrow ? 'max-w-md' : 'max-w-3xl')}>
        <PageHeader
          activeRole={guide.role}
          homeRole={isHelpRole(role) ? role : null}
        />

        {isAdmin ? (
          <Tabs
            value={viewRole}
            onValueChange={(v) => {
              if (isHelpRole(v)) setViewRole(v);
            }}
            items={HELP_ROLES.map<TabItem>((r) => ({
              value: r,
              label: ROLE_LABELS[r],
              content: <GuideBody guide={getGuide(r)!} userRole={userRole} />,
            }))}
          />
        ) : (
          <GuideBody guide={guide} userRole={userRole} />
        )}
      </div>
    </main>
  );
}

// ── Header with back link + title ─────────────────────────────────────────────
function PageHeader({
  activeRole,
  homeRole,
}: {
  activeRole: HelpRole;
  homeRole: HelpRole | null;
}) {
  const backHref = homeRole ? getGuide(homeRole)?.home ?? '/' : '/';
  return (
    <header className="mb-5">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-primary)]/10">
          <BookOpen className="h-6 w-6 text-[var(--brand-primary)]" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight text-gray-900">Help &amp; Guides</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Step-by-step help for {ROLE_LABELS[activeRole]}.
          </p>
        </div>
      </div>
    </header>
  );
}

// ── The body of a single role's guide ─────────────────────────────────────────
function GuideBody({ guide, userRole }: { guide: RoleGuide; userRole: HelpRole | null }) {
  // Only link "my home" when this IS the caller's own guide — an admin browsing another role's
  // guide must not be sent to a portal their token can't enter (the edge proxy would bounce them
  // to login), and "my home" is the wrong label for someone else's portal.
  const isOwnGuide = guide.role === userRole;
  return (
    <div className="space-y-4">
      {/* Intro — the role label is the section's h2 (keeps the h1 → h2 → h3 heading order). */}
      <Card className="rounded-2xl border-gray-200 shadow-sm">
        <CardContent className="px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
            <Compass className="h-4 w-4 shrink-0 text-[var(--brand-primary)]" />
            {guide.label}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">{guide.intro}</p>
          {isOwnGuide && (
            <Link
              href={guide.home}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand-primary)] transition-colors hover:underline"
            >
              <MapPin className="h-4 w-4" />
              Go to my home screen
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </CardContent>
      </Card>

      {/* Topics */}
      {guide.topics.map((topic, i) => (
        <Card key={topic.title} className="rounded-2xl border-gray-200 shadow-sm">
          <CardHeader className="px-5 pb-2 pt-5">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-primary)]/10 text-xs font-bold text-[var(--brand-primary)]">
                {i + 1}
              </span>
              {topic.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <ol className="space-y-2.5">
              {topic.steps.map((step, si) => (
                <li key={si} className="flex gap-3 text-sm leading-relaxed text-gray-700">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gray-100 text-[11px] font-semibold text-gray-500">
                    {si + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ))}

      {/* Shared field rules (only for capture/review roles) */}
      {guide.showFieldNotes && (
        <Card className="rounded-2xl border-[var(--brand-primary)]/25 bg-[var(--brand-primary)]/5 shadow-sm">
          <CardHeader className="px-5 pb-2 pt-5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="h-5 w-5 text-[var(--brand-primary)]" />
              {FIELD_NOTES.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <ul className="space-y-2.5">
              {FIELD_NOTES.points.map((point, pi) => (
                <li key={pi} className="flex gap-2.5 text-sm leading-relaxed text-gray-700">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand-primary)]" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
