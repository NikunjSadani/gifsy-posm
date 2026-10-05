import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import { ToastProvider } from '@/components/ui/toast';
import { getTenantConfig, getBrandStyle } from '@/lib/platform/server';
import { ClientConfigProvider } from '@/lib/platform/client-config-context';
import SessionExpiryGuard from '@/components/auth/SessionExpiryGuard';
import PermissionDeniedToast from '@/components/rbac/permission-denied-toast';
import { UpdateNudge } from '@/components/pwa/update-nudge';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const config = await getTenantConfig();
  return {
    title: {
      default: `${config.branding.displayName} — Field Execution`,
      template: `%s | ${config.branding.displayName}`,
    },
    description: `${config.branding.displayName} — Element recce, approval, installation and audit.`,
    // PWA: installable web-app manifest + iOS home-screen behaviour (online-only, no SW).
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: 'Kwality Field',
    },
    icons: {
      // Purpose-built square icons (the logo centred on white). The manifest carries the Android
      // install/maskable set; these drive the browser tab + the iOS home-screen icon.
      icon: [
        { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      apple: '/icons/apple-touch-icon.png',
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Allow pinch-zoom (WCAG 1.4.4) — field users must be able to zoom to read small text or
  // inspect a captured / ghost-overlay photo. (Previously maximumScale:1 disabled zoom.)
  maximumScale: 5,
  userScalable: true,
  // Extend under the iOS notch/home-indicator so an installed PWA can use the safe area.
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const config = await getTenantConfig();
  const brandStyle = getBrandStyle(config);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased overflow-x-hidden`}
    >
      <head>
        {/* Inject brand CSS variables — drives all brand colours. brandStyle is sanitised at
            the source (buildCssVariables): every interpolated colour is hard-guarded to a
            6-digit hex, so this sink cannot be broken out of. */}
        <style dangerouslySetInnerHTML={{ __html: brandStyle }} />
        <meta name="theme-color" content={config.branding.primaryColor} />
      </head>
      <body
        suppressHydrationWarning
        className="min-h-full flex flex-col bg-gray-50 text-gray-900 font-sans overflow-x-hidden"
      >
        <ClientConfigProvider config={config}>
          <ToastProvider>
            {children}
            {/* Turns a global /api 403 into a clear "no permission" toast. Inside
                ToastProvider so it can raise toasts. */}
            <PermissionDeniedToast />
          </ToastProvider>
        </ClientConfigProvider>
        {/* Bounce to /auth/login on any /api 401 (expired/invalid token), after first
            attempting a silent refresh. App-wide. */}
        <SessionExpiryGuard />
        {/* Online-only "new version available" nudge — compares the client's baked build id
            against the live /version endpoint and offers a refresh after a deploy. No SW. */}
        <UpdateNudge />
        {/* Single app-wide react-hot-toast surface. The login page and the field/review/
            audit/admin consoles all raise `toast(...)`; without ONE Toaster mounted here those
            calls render nothing, and more than one Toaster renders every toast twice. Kept
            distinct from the chassis ToastProvider above (a separate system). */}
        <Toaster position="top-center" toastOptions={{ duration: 4000 }} />
      </body>
    </html>
  );
}
