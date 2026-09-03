'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAdminSession } from '@/hooks/useAdminSession';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

/**
 * ProtectedRoute keeps public recognition open and gates admin-only tools.
 */
export default function ProtectedRoute({
  children,
  requireAdmin = false,
}: ProtectedRouteProps): React.ReactElement | null {
  const router = useRouter();
  const pathname = usePathname();
  const { isAdmin, isLoading } = useAdminSession();

  useEffect(() => {
    if (!requireAdmin || isLoading || isAdmin) return;
    router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
  }, [isAdmin, isLoading, pathname, requireAdmin, router]);

  if (!requireAdmin) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Checking admin access...</p>
      </div>
    );
  }

  if (!isAdmin) return null;

  return <>{children}</>;
}
