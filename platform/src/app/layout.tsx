import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '@/components/ui/toast';
import { getTenantConfig, getBrandStyle } from '@/lib/platform/server';
import { ClientConfigProvider } from '@/lib/platform/client-config-context';
import SessionExpiryGuard from '@/components/auth/SessionExpiryGuard';
import PermissionDeniedToast from '@/components/rbac/permission-denied-toast';

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
    description: `${config.branding.displayName} — point-of-sale material recce, approval, installation and audit.`,
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
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
      </body>
    </html>
  );
}
