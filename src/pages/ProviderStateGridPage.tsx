import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { ProviderStateGrid } from '@/components/grid/ProviderStateGrid';
import { useGridData } from '@/hooks/useGridData';

export default function ProviderStateGridPage() {
  const { profile, roles } = useAuth();
  const gridData = useGridData();
  
  const userRole = roles.includes('admin') ? 'admin' : 
                   roles.includes('leadership') ? 'leadership' : 
                   roles.includes('physician') ? 'physician' : 'provider';

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar 
        userRole={userRole}
        userName={profile?.full_name || 'User'}
        userEmail={profile?.email || ''}
        userAvatarUrl={profile?.avatar_url || undefined}
      />
      
      <main className="pl-64 transition-all duration-300">
        <div className="p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold">Provider–State Grid</h1>
            <p className="text-muted-foreground mt-1">
              Visual overview of licensure and credentialing status across all providers and states
            </p>
          </div>

          <ProviderStateGrid data={gridData} />
        </div>
      </main>
    </div>
  );
}
