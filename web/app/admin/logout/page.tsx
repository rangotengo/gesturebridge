'use client';

import React, { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { adminQueryKeys } from '@/app/admin/queries';

export default function AdminLogoutPage(): React.ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    async function logout(): Promise<void> {
      await fetch('/api/admin/logout', { method: 'POST' });
      queryClient.setQueryData(adminQueryKeys.me, null);
      router.replace('/');
    }

    void logout();
  }, [queryClient, router]);

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-24">
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Signing out...</p>
      </div>
    </main>
  );
}
