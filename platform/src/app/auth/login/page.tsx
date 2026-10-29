'use client';

/**
 * Field-app login — email + password (replaced phone + OTP, 2026-10-01). Kwality-themed,
 * mobile-first (red sticky header, white logo pill, rounded-2xl card, active:scale-95).
 *
 * Flow: email + password → `loginAction` server action (POST /api/auth/login; it sets the
 * httpOnly session cookies) → store the non-sensitive user for client routing → role home.
 */

import { useState, useEffect, useRef, Suspense } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { getRoleHome } from '@/lib/auth-client';
import { loginAction } from '@/lib/field/login-action';
import { CLIENT_ID } from '@/lib/field/config';
import { InstallButton } from '@/components/pwa/install-button';

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  // Synchronous in-flight guard: a fast double-tap re-enters submit before `loading` (state) has
  // re-rendered the disabled button, which would fire two login requests.
  const submittingRef = useRef(false);

  // Surface a session-expiry bounce (proxy redirects here with ?expired=1).
  useEffect(() => {
    if (searchParams.get('expired')) {
      toast('Your session expired. Please sign in again.', { icon: '🔒' });
    }
  }, [searchParams]);

  const canSubmit = email.trim().length > 0 && password.length > 0;

  const submit = async () => {
    if (submittingRef.current || loading) return; // synchronous double-tap guard
    if (!canSubmit) {
      toast.error('Enter your email and password');
      return;
    }
    if (!CLIENT_ID) {
      toast.error('Login is not configured yet (missing client id). Please contact support.');
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    try {
      const result = await loginAction(email.trim(), password, CLIENT_ID);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Persist only the NON-sensitive user (the real credential is the httpOnly cookie).
      try {
        localStorage.setItem('user', JSON.stringify(result.user));
      } catch {
        /* private-mode / storage-blocked: the guard still relies on the cookie + backend */
      }
      toast.success('Signed in!', { duration: 1000 });
      router.replace(getRoleHome(result.user.role));
    } finally {
      // On success we navigate away; on failure this re-enables submit for another try.
      setLoading(false);
      submittingRef.current = false;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Sticky red header with white logo pill */}
      <header className="bg-[var(--brand-primary)] shadow-lg sticky top-0 z-50">
        <div className="max-w-md mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="bg-white rounded-xl px-2 py-1 shadow-sm shrink-0">
            <Image src="/kwality-walls-logo.png" alt="Kwality Wall's" width={52} height={52} priority />
          </div>
          <div className="text-right">
            <p className="text-white font-black text-base tracking-wide leading-tight">Field Execution</p>
            <div className="flex items-center justify-end gap-1 mt-0.5">
              <span className="w-4 h-px bg-[var(--brand-accent)]" />
              <p className="text-[var(--brand-accent)] text-[10px] font-semibold tracking-widest uppercase">
                Elements Vendor App
              </p>
              <span className="w-4 h-px bg-[var(--brand-accent)]" />
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-md mx-auto px-6 pb-10">
        <div className="mt-8 mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Welcome</h1>
          <p className="text-gray-500 mt-1 text-sm">Sign in to continue</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 fade-in">
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canSubmit && submit()}
            placeholder="you@company.com"
            className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-base text-gray-900 focus:outline-none focus:border-[var(--brand-primary)] transition-colors"
            autoFocus
          />

          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2 mt-4">
            Password
          </label>
          <div className="flex items-stretch rounded-xl border-2 border-gray-200 focus-within:border-[var(--brand-primary)] transition-colors overflow-hidden">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && submit()}
              placeholder="Your password"
              className="flex-1 px-4 py-3 text-base text-gray-900 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="px-3 text-sm font-medium text-gray-500 hover:text-gray-700 bg-gray-50 border-l border-gray-200"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>

          <button
            onClick={submit}
            disabled={loading || !canSubmit}
            className="w-full mt-6 bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white font-bold py-4 rounded-2xl text-lg disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          {/* PWA install shortcut — only renders when installable (Android/Chromium) or on iOS;
              hidden when already installed or unsupported. */}
          <InstallButton />

          <p className="text-center text-xs text-gray-400 mt-4">
            Forgot your password? Contact your administrator.
          </p>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">Kwality Elements Field Execution</p>
      </main>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
