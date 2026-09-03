'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  adminQueryKeys,
  fetchAdminSetupStatus,
  type AdminUser,
} from '@/app/admin/queries';

function getSafeNextPath(): string {
  if (typeof window === 'undefined') return '/';
  const nextPath = new URL(window.location.href).searchParams.get('next');
  if (!nextPath || !nextPath.startsWith('/') || nextPath.startsWith('//')) return '/';
  return nextPath;
}

export default function AdminLoginPage(): React.ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nextPath] = useState(getSafeNextPath);

  const setupQuery = useQuery({
    queryKey: adminQueryKeys.setupStatus,
    queryFn: fetchAdminSetupStatus,
  });

  useEffect(() => {
    if (setupQuery.data?.needsSetup) {
      router.replace(`/admin/signup?next=${encodeURIComponent(nextPath)}`);
    }
  }, [nextPath, router, setupQuery.data?.needsSetup]);

  const loginMutation = useMutation({
    mutationFn: async (): Promise<AdminUser> => {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as { admin?: AdminUser; error?: string };
      if (!response.ok || !data.admin) {
        throw new Error(data.error ?? 'Admin login failed.');
      }
      return data.admin;
    },
    onSuccess: (admin) => {
      queryClient.setQueryData(adminQueryKeys.me, admin);
      router.replace(nextPath);
    },
  });

  if (setupQuery.isLoading || setupQuery.data?.needsSetup) {
    return (
      <main className="auth-page">
        <div className="auth-backdrop" aria-hidden="true" />
        <section className="auth-card">
          <div className="loading-screen">
            <div className="loading-spinner" />
            <p>{setupQuery.data?.needsSetup ? 'Redirecting to signup…' : 'Checking admin setup…'}</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <div className="auth-backdrop" aria-hidden="true" />
      <section className="auth-card">
        <p className="auth-eyebrow">GestureBridge</p>
        <h1 className="auth-title">Admin access</h1>
        <p className="auth-subtitle">
          Recognition stays public. Sign in to unlock dataset collection, import, and training.
        </p>

        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            loginMutation.mutate();
          }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="admin-email">
              Email
            </label>
            <input
              id="admin-email"
              className="form-input"
              type="email"
              autoComplete="username"
              placeholder="admin@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="admin-password">
              Password
            </label>
            <input
              id="admin-password"
              className="form-input"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          <button
            className="btn btn-primary btn-lg auth-submit"
            type="submit"
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {loginMutation.error && (
          <div className="alert alert-error auth-alert" role="alert">
            {loginMutation.error.message}
          </div>
        )}

        {setupQuery.error && (
          <div className="alert alert-error auth-alert" role="alert">
            {setupQuery.error.message}
          </div>
        )}

        <p className="auth-footer">
          <Link href="/">Back to recognition</Link>
        </p>
      </section>
    </main>
  );
}
