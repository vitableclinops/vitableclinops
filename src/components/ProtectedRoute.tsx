import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
  requiredRoles?: Array<'admin' | 'provider' | 'physician' | 'pod_lead' | 'scheduling'>;
}

export function ProtectedRoute({ children, requiredRoles }: ProtectedRouteProps) {
  const { user, profile, roles, rolesHydrated, loading } = useAuth();
  const location = useLocation();
  const { toast } = useToast();

  const missingRole =
    !!user &&
    rolesHydrated &&
    !!requiredRoles?.length &&
    !requiredRoles.some((role) => (roles as string[]).includes(role));

  // Surface an explanation before redirecting — otherwise role-gated links just
  // silently bounce to "/" and users think the link is broken.
  useEffect(() => {
    if (missingRole) {
      toast({
        title: "You don't have access to that page",
        description: `This page requires the ${requiredRoles!.join(' or ')} role. Contact an admin if you believe this is a mistake.`,
        variant: 'destructive',
      });
    }
  }, [missingRole, requiredRoles, toast]);

  // Always wait for the auth session. If the route is role-gated, also wait
  // for roles to hydrate (but auth itself should never be blocked by role fetches).
  if (loading || (requiredRoles?.length && !rolesHydrated)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (missingRole) {
    return <Navigate to="/" replace />;
  }

  // First-login onboarding enforcement for providers
  // Skip if already on onboarding page or if user has admin/physician role
  const isOnboardingPage = location.pathname === '/onboarding';
  const isProviderRole = roles.includes('provider');
  const isNonProviderRole = roles.includes('admin') || roles.includes('physician') || roles.includes('pod_lead');
  const hasCompletedOnboarding = profile?.onboarding_completed === true;

  // Only enforce onboarding for pure provider users who haven't completed it
  if (
    !isOnboardingPage &&
    isProviderRole &&
    !isNonProviderRole &&
    rolesHydrated &&
    profile &&
    !hasCompletedOnboarding
  ) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
