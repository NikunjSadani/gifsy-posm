/* ─── Navigation config (chassis placeholder) ─────────────────────────────────
   The loyalty ALL_NAV_ITEMS (KYC / Schemes / Credits / Payouts / TDS / …) is stripped.
   This is the minimal POSM placeholder the Sidebar / NavBottom consume via props. Grow it
   into the real per-portal nav as the admin/field/review/audit surfaces land.
─────────────────────────────────────────────────────────────────────────────── */

import { LayoutDashboard, type LucideIcon } from 'lucide-react';

export interface NavItemDef {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Minimal placeholder nav — a single Dashboard entry. */
export const POSM_NAV: NavItemDef[] = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
];
