'use client';

import { useQuery } from '@tanstack/react-query';
import { adminQueryKeys, fetchAdminSession, type AdminUser } from '@/app/admin/queries';

export function useAdminSession(): {
  admin: AdminUser | null;
  isAdmin: boolean;
  isLoading: boolean;
  error: Error | null;
} {
  const query = useQuery({
    queryKey: adminQueryKeys.me,
    queryFn: fetchAdminSession,
  });

  const admin = query.data ?? null;
  return {
    admin,
    isAdmin: admin?.role === 'admin',
    isLoading: query.isLoading,
    error: query.error,
  };
}
