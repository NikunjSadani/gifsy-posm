/**
 * SiteFooter — the "Powered by Gifsy" vendor credit.
 *
 * Gifsy is the white-label operator; the client is the tenant. This credit appears on the
 * client-facing surfaces (login + the field/review/audit/admin portals), NOT the Gifsy
 * operator portal (where it would be redundant).
 *
 * No hooks — safe in both server and client layouts. Kept deliberately subtle.
 * (Future: the label could be made tenant-configurable via the SSR-branding work.)
 */
export function SiteFooter({ className = '' }: { className?: string }) {
  return (
    <footer className={`mt-8 text-center text-sm text-gray-400 ${className}`}>
      Powered by <span className="font-semibold text-gray-500">Gifsy</span>
    </footer>
  );
}
