'use client';

/**
 * Field-app OTP login — Kwality-themed, mobile-first (echoes the Kwality Walls microsite:
 * red sticky header, white logo pill, rounded-2xl cards, 6-box OTP, active:scale-95).
 *
 * Flow: phone + T&C → send-otp (client fetch through the `/api` proxy) → 6-box OTP with a
 * resend countdown → verify via the `loginAction` server action (which sets the httpOnly
 * session cookies) → store the non-sensitive user for client routing → go to the role home.
 *
 * Dev: with FIXED_OTP=123456 on the backend, any 6-digit OTP is accepted.
 */

import { useState, useEffect, useRef, Suspense } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { api } from '@/lib/api-client';
import { getRoleHome } from '@/lib/auth-client';
import { loginAction } from '@/lib/field/login-action';
import { CLIENT_ID } from '@/lib/field/config';

const RESEND_SECONDS = 45;

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<'mobile' | 'otp'>('mobile');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  // Synchronous in-flight guards: a fast double-tap re-enters the handler before `loading`
  // (state) has re-rendered the disabled button, which would fire two OTP/verify requests.
  const sendingRef = useRef(false);
  const verifyingRef = useRef(false);

  // Surface a session-expiry bounce (proxy redirects here with ?expired=1).
  useEffect(() => {
    if (searchParams.get('expired')) {
      toast('Your session expired. Please sign in again.', { icon: '🔒' });
    }
  }, [searchParams]);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  const sendOtp = async () => {
    if (sendingRef.current || loading) return; // synchronous double-tap guard
    if (!/^\d{10}$/.test(mobile)) {
      toast.error('Please enter a valid 10-digit mobile number');
      return;
    }
    if (!CLIENT_ID) {
      toast.error('Login is not configured yet (missing client id). Please contact support.');
      return;
    }
    sendingRef.current = true;
    setLoading(true);
    try {
      const res = await api.post<{ success: boolean; expiresIn: number }>('/api/auth/send-otp', {
        phone: mobile,
        channel: 'SMS',
        clientId: CLIENT_ID,
      });
      if (!res.success) {
        toast.error(res.error || 'Could not send the OTP. Please try again.');
        return;
      }
      setStep('otp');
      setOtp(['', '', '', '', '', '']);
      setResendTimer(RESEND_SECONDS);
      toast.success('OTP sent!');
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } finally {
      setLoading(false);
      sendingRef.current = false;
    }
  };

  const onOtpChange = (i: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const next = [...otp];
    next[i] = value;
    setOtp(next);
    if (value && i < 5) otpRefs.current[i + 1]?.focus();
  };

  const onOtpKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus();
  };

  const onOtpPaste = (e: React.ClipboardEvent) => {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!digits) return;
    e.preventDefault();
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < digits.length; i++) next[i] = digits[i];
    setOtp(next);
    otpRefs.current[Math.min(digits.length, 5)]?.focus();
  };

  const verify = async () => {
    if (verifyingRef.current || loading) return; // synchronous double-tap guard
    const code = otp.join('');
    if (code.length !== 6) {
      toast.error('Please enter the complete 6-digit OTP');
      return;
    }
    verifyingRef.current = true;
    setLoading(true);
    try {
      const result = await loginAction(mobile, code, CLIENT_ID);
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
      toast.success('Signed in!');
      router.replace(getRoleHome(result.user.role));
    } finally {
      // On success we navigate away; on failure this re-enables verify for another try.
      setLoading(false);
      verifyingRef.current = false;
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
                POSM Vendor App
              </p>
              <span className="w-4 h-px bg-[var(--brand-accent)]" />
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-md mx-auto px-6 pb-10">
        <div className="mt-8 mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900">
            {step === 'mobile' ? 'Welcome' : 'Verify OTP'}
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            {step === 'mobile' ? 'Sign in to start your field visits' : 'Enter the code we sent you'}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 fade-in">
          {step === 'mobile' ? (
            <>
              <label htmlFor="mobile" className="block text-sm font-medium text-gray-700 mb-2">
                Mobile number
              </label>
              <div className="flex items-stretch rounded-xl border-2 border-gray-200 focus-within:border-[var(--brand-primary)] transition-colors overflow-hidden">
                <span className="flex items-center px-3 text-gray-500 bg-gray-50 text-sm font-medium border-r border-gray-200">
                  +91
                </span>
                <input
                  id="mobile"
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={10}
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  onKeyDown={(e) => e.key === 'Enter' && agreed && sendOtp()}
                  placeholder="10-digit mobile number"
                  className="flex-1 px-4 py-3 text-lg text-gray-900 focus:outline-none"
                  autoFocus
                />
              </div>

              <label className="flex items-start gap-2.5 mt-4 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="w-4 h-4 mt-0.5 flex-none accent-[var(--brand-primary)] cursor-pointer"
                />
                <span className="text-sm text-gray-600">
                  I accept the <span className="text-[var(--brand-primary)] font-medium">Terms &amp; Conditions</span> and
                  consent to receive an OTP by SMS.
                </span>
              </label>

              <button
                onClick={sendOtp}
                disabled={loading || mobile.length !== 10 || !agreed}
                className="w-full mt-5 bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white font-bold py-4 rounded-2xl text-lg disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
              >
                {loading ? 'Sending…' : 'Send OTP'}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-4">
                Sent to <span className="font-semibold">+91 {mobile}</span>
                <button
                  onClick={() => {
                    setStep('mobile');
                    setResendTimer(0);
                  }}
                  className="ml-2 text-[var(--brand-primary)] text-sm underline"
                >
                  Change
                </button>
              </p>

              <div className="flex gap-2 justify-center mb-5" onPaste={onOtpPaste}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      otpRefs.current[i] = el;
                    }}
                    type="tel"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => onOtpChange(i, e.target.value)}
                    onKeyDown={(e) => onOtpKeyDown(i, e)}
                    aria-label={`OTP digit ${i + 1}`}
                    className="w-11 h-14 text-center text-xl font-bold text-gray-900 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-[var(--brand-primary)] transition-colors"
                  />
                ))}
              </div>

              <button
                onClick={verify}
                disabled={loading || otp.join('').length !== 6}
                className="w-full bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white font-bold py-4 rounded-2xl text-lg disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
              >
                {loading ? 'Verifying…' : 'Verify & Continue'}
              </button>

              <div className="text-center mt-4">
                {resendTimer > 0 ? (
                  <p className="text-gray-500 text-sm">Resend OTP in {resendTimer}s</p>
                ) : (
                  <button
                    onClick={sendOtp}
                    disabled={loading}
                    className="text-[var(--brand-primary)] text-sm font-medium underline disabled:opacity-50"
                  >
                    Resend OTP
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">Kwality POSM Field Execution</p>
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
