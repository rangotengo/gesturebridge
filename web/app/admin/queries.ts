export interface AdminUser {
  email: string;
  role: 'admin';
}

export const adminQueryKeys = {
  me: ['admin', 'me'] as const,
  setupStatus: ['admin', 'setup-status'] as const,
};

export async function fetchAdminSession(): Promise<AdminUser | null> {
  const response = await fetch('/api/admin/me', {
    cache: 'no-store',
  });

  if (response.status === 401) return null;

  const data = (await response.json()) as { admin?: AdminUser; error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? 'Failed to load admin session.');
  }

  return data.admin ?? null;
}

export async function fetchAdminSetupStatus(): Promise<{ needsSetup: boolean }> {
  const response = await fetch('/api/admin/setup-status', {
    cache: 'no-store',
  });
  const data = (await response.json()) as {
    needsSetup?: boolean;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error ?? 'Failed to check admin setup status.');
  }
  return { needsSetup: Boolean(data.needsSetup) };
}
