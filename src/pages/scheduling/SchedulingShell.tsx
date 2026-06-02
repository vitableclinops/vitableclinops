import type { ReactNode } from 'react';
import { SchedulingSidebar } from '@/components/scheduling/SchedulingSidebar';
import { useAuth } from '@/hooks/useAuth';

interface SchedulingShellProps {
  children: ReactNode;
}

export default function SchedulingShell({ children }: SchedulingShellProps) {
  const { profile, roles } = useAuth();
  const showAdminDashboardLink = roles.includes('admin');

  return (
    <div className="min-h-screen bg-background">
      <SchedulingSidebar
        userName={profile?.full_name || 'User'}
        userEmail={profile?.email || ''}
        userAvatarUrl={profile?.avatar_url || undefined}
        showAdminDashboardLink={showAdminDashboardLink}
      />
      <main className="ml-16 lg:ml-64 transition-all duration-300 min-w-0">
        <div className="p-4 md:p-6 lg:p-8 space-y-6">{children}</div>
      </main>
    </div>
  );
}
