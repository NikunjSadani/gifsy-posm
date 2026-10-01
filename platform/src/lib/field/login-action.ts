'use server';

/**
 * Login server action — email + password (replaced phone + OTP, 2026-10-01). Establishes the
 * httpOnly session.
 *
 * The proxy treats `/api/auth/login` as a PUBLIC pass-through: it forwards the request to the
 * backend but does NOT set any cookie. So the token/refresh pair the backend returns must be
 * turned into httpOnly cookies HERE, server-side, so the access token is never exposed to client
 * JS (AF-6). The client login page calls this action, then stores only the non-sensitive `user`
 * object for client routing.
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
  email: string;
}

export type LoginResult =
  | { ok: true; user: LoginUser }
  | { ok: false; error: string };

export async function loginAction(
  email: string,
  password: string,
  clientId: string,
): Promise<LoginResult> {
  let body: {
    success?: boolean;
    error?: string;
    data?: { accessToken?: string; refreshToken?: string; user?: LoginUser };
  } | null = null;

  try {
    const res = await fetch(`${API_URL}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, clientId }),
      signal: AbortSignal.timeout(12_000),
    });
    body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: body?.error ?? 'Could not sign in. Please try again.' };
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
