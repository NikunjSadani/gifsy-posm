'use server';

/**
 * Login server action — verify OTP and establish the httpOnly session.
 *
 * The proxy treats `/api/auth/verify-otp` as a PUBLIC pass-through: it forwards the request to
 * the backend but does NOT set any cookie. So the token/refresh pair the backend returns must
 * be turned into httpOnly cookies HERE, server-side, exactly like the chassis refresh/logout
 * actions — the access token must never be exposed to client JS (AF-6). The client login page
 * calls this action, then stores only the non-sensitive `user` object for client routing.
 *
 * send-otp needs no cookie, so it stays a plain client fetch through the `/api` proxy; only
 * the token-minting verify step runs here.
 */

import { cookies } from 'next/headers';
import {
  REFRESH_MAX_AGE,
  accessCookieMaxAge,
  sessionCookieOptions,
} from '@/lib/auth-refresh';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface LoginUser {
  id: string;
  name: string;
  role: string;
  phone: string;
}

export type LoginResult =
  | { ok: true; user: LoginUser }
  | { ok: false; error: string };

export async function loginAction(
  phone: string,
  otp: string,
  clientId: string,
): Promise<LoginResult> {
  let body: {
    success?: boolean;
    error?: string;
    data?: { accessToken?: string; refreshToken?: string; user?: LoginUser };
  } | null = null;

  try {
    const res = await fetch(`${API_URL}/v1/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp, clientId }),
      signal: AbortSignal.timeout(12_000),
    });
    body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: body?.error ?? 'Could not verify the OTP. Please try again.' };
    }
  } catch {
    return { ok: false, error: 'Network error. Please check your connection and try again.' };
  }

  const accessToken = body?.data?.accessToken;
  const refreshToken = body?.data?.refreshToken;
  const user = body?.data?.user;
  if (!accessToken || !refreshToken || !user) {
    return { ok: false, error: 'Unexpected response from the server. Please try again.' };
  }

  const store = await cookies();
  store.set('token', accessToken, sessionCookieOptions(accessCookieMaxAge(accessToken)));
  store.set('refresh_token', refreshToken, sessionCookieOptions(REFRESH_MAX_AGE));

  return { ok: true, user };
}
