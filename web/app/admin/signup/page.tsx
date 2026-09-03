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

export default function AdminSignupPage(): React.ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nextPath] = useState(getSafeNextPath);

  const setupQuery = useQuery({
    queryKey: adminQueryKeys.setupStatus,
    queryFn: fetchAdminSetupStatus,
  });

  useEffect(() => {
    if (setupQuery.data && !setupQuery.data.needsSetup) {
      router.replace(`/admin/login?next=${encodeURIComponent(nextPath)}`);
    }
  }, [nextPath, router, setupQuery.data]);

  const signupMutation = useMutation({
    mutationFn: async (): Promise<AdminUser> => {
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match.');
      }
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters.');
      }

      const response = await fetch('/api/admin/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as { admin?: AdminUser; error?: string };
      if (!response.ok || !data.admin) {
        throw new Error(data.error ?? 'Admin signup failed.');
      }
      return data.admin;
    },
    onSuccess: (admin) => {
      queryClient.setQueryData(adminQueryKeys.me, admin);
      queryClient.setQueryData(adminQueryKeys.setupStatus, { needsSetup: false });
      router.replace(nextPath);
    },
  });

  if (setupQuery.isLoading || (setupQuery.data && !setupQuery.data.needsSetup)) {
    return (
      <main className="auth-page">
        <div className="auth-backdrop" aria-hidden="true" />
        <section className="auth-card">
          <div className="loading-screen">
            <div className="loading-spinner" />
            <p>
              {setupQuery.data && !setupQuery.data.needsSetup
                ? 'Admin already exists. Redirecting…'
                : 'Checking admin setup…'}
            </p>
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
        <h1 className="auth-title">Create admin</h1>
        <p className="auth-subtitle">
          No admin account yet. Create the first one — credentials are stored in MongoDB.
        </p>

        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            signupMutation.mutate();
          }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="admin-signup-email">
              Email
            </label>
            <input
              id="admin-signup-email"
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
            <label className="form-label" htmlFor="admin-signup-password">
              Password
            </label>
            <input
              id="admin-signup-password"
              className="form-input"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="admin-signup-confirm">
              Confirm password
            </label>
            <input
              id="admin-signup-confirm"
              className="form-input"
              type="password"
              autoComplete="new-password"
              placeholder="Repeat password"
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </div>

          <button
            className="btn btn-primary btn-lg auth-submit"
            type="submit"
            disabled={signupMutation.isPending}
          >
            {signupMutation.isPending ? 'Creating…' : 'Create admin account'}
          </button>
        </form>

        {signupMutation.error && (
          <div className="alert alert-error auth-alert" role="alert">
            {signupMutation.error.message}
          </div>
        )}

        {setupQuery.error && (
          <div className="alert alert-error auth-alert" role="alert">
            {setupQuery.error.message}
          </div>
        )}

        <p className="auth-footer">
          Already have an account? <Link href="/admin/login">Sign in</Link>
          {' · '}
          <Link href="/">Back to recognition</Link>
        </p>
      </section>
    </main>
  );
}
