/**
 * ClientConfig — the single source of truth for everything that varies between
 * tenants of the POSM platform.
 *
 * This is the STRIPPED chassis version: the loyalty registry (wallet / invoicing /
 * approval-hierarchy / partner-classes / notifications) is gone. POSM handles no money
 * and no loyalty programs, so the config carries only branding + a small generic feature
 * map. Real per-tenant config for the field-execution product is layered on in later waves.
 *
 * Rules:
 *  - Branding + feature flags are set by GIFSY_ADMIN only.
 *  - CLIENT_ADMIN reads this config but cannot write any part of it.
 *  - Pure helpers here have no side-effects and are fully testable.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Feature flags (generic — POSM modules are toggled here as they land)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureFlags {
  /** Show nearby outlets on the free OpenStreetMap map during recce. */
  nearbyOutlets: boolean;
  /** Enforce fine-grained RBAC permission checks (env master-switch gated). */
  rbacEnforcement: boolean;
}

export type FeatureKey = keyof FeatureFlags;

// ─────────────────────────────────────────────────────────────────────────────
// Branding
// ─────────────────────────────────────────────────────────────────────────────

export interface BrandingConfig {
  /** Shown in the app header, e.g. the client's program name. */
  displayName: string;
  /** Primary brand hex, e.g. "#E3000F". Drives --brand-primary. */
  primaryColor: string;
  /**
   * Optional explicit dark shade for hover/press states (--brand-primary-dark). When
   * omitted it is derived from primaryColor. Set it to pin an exact brand value.
   */
  primaryColorDark?: string;
  /** Optional accent hex (--brand-accent), e.g. Kwality yellow "#FFD200". */
  accentColor?: string;
  /** Absolute or relative path to the brand logo. */
  logoUrl: string;
  /** Optional white/light wordmark for dark surfaces (sidebar). */
  wordmarkWhiteUrl?: string;
  faviconUrl: string;
  supportEmail: string;
  supportPhone: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Root ClientConfig
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientConfig {
  /** URL-safe lowercase identifier — drives subdomain routing. */
  slug: string;
  /** Custom/branded hostnames that resolve to this tenant, if any. */
  domains?: string[];
  /** Internal display name used in the GIFSY operator console. */
  internalName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ONBOARDING';
  onboardedAt: string; // ISO date string

  branding: BrandingConfig;
  features: FeatureFlags;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true if the given feature flag is enabled for this client. */
export function isFeatureEnabled(config: ClientConfig, key: FeatureKey): boolean {
  return !!(config.features as unknown as Record<string, boolean>)[key];
}

/**
 * Validates a ClientConfig and returns human-readable error strings.
 * Empty array = valid.
 */
export function validateClientConfig(config: ClientConfig): string[] {
  const errors: string[] = [];

  if (!config.slug.trim()) {
    errors.push('slug is required and must not be empty.');
  } else if (!/^[a-z0-9-]+$/.test(config.slug)) {
    errors.push('slug must be lowercase alphanumeric with hyphens only.');
  }

  if (!config.branding.displayName.trim()) {
    errors.push('branding.displayName is required.');
  }

  if (!HEX6_RE.test(config.branding.primaryColor)) {
    errors.push('branding.primaryColor must be a valid 6-digit hex color (e.g. #E3000F).');
  }

  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS variable builder
// ─────────────────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0'))
    .join('');
}

function darken(hex: string, amount = 0.12): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

function lighten(hex: string, amount = 0.92): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

/**
 * Strict 6-digit hex guard + safe fallback for a brand colour.
 *
 * SECURITY: the returned CSS is injected into the root layout via
 * `<style dangerouslySetInnerHTML>` — an HTML/CSS sink. Colours are interpolated RAW,
 * so a malformed value could break out of the <style> element. Sanitising HERE — at the
 * serialisation boundary — makes the sink provably safe regardless of the colour's source:
 * the only raw-interpolated tokens can ever be `#` + exactly 6 hex digits.
 */
const HEX6_RE = /^#[0-9a-fA-F]{6}$/;
const SAFE_PRIMARY = '#E3000F';

function safeHex(raw: string | null | undefined, fallback: string): string {
  return raw && HEX6_RE.test(raw) ? raw : fallback;
}

/**
 * Generates a CSS `:root { ... }` block with brand variables derived from the client's
 * branding. Injected into the HTML <head> by the root layout. `--brand-primary-dark` and
 * `--brand-accent` use the explicit branding values when present, else are derived.
 */
export function buildCssVariables(config: ClientConfig): string {
  const primary = safeHex(config.branding.primaryColor, SAFE_PRIMARY);
  const dark = safeHex(config.branding.primaryColorDark, darken(primary));
  const light = lighten(primary);
  const accent = safeHex(config.branding.accentColor, '#FFD200');
  return `:root {
  --brand-primary: ${primary};
  --brand-primary-dark: ${dark};
  --brand-primary-light: ${light};
  --brand-accent: ${accent};
}`;
}
