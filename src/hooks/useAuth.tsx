import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'>;
type AppRole = 'admin' | 'provider' | 'physician' | 'leadership';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  loading: boolean;
  signOut: () => Promise<void>;
  hasRole: (role: AppRole) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const fetchProfileAndRoles = async (userId: string) => {
      const [profileResult, rolesResult] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('user_roles').select('role').eq('user_id', userId),
      ]);

      if (cancelledRef.current) return;

      if (profileResult.error) {
        console.error('Error fetching profile:', profileResult.error);
      }
      if (rolesResult.error) {
        console.error('Error fetching roles:', rolesResult.error);
      }

      setProfile(profileResult.data ?? null);
      setRoles((rolesResult.data ?? []).map((r) => r.role as AppRole));
    };

    const applySession = async (nextSession: Session | null) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (nextSession?.user) {
        await fetchProfileAndRoles(nextSession.user.id);
      } else {
        if (cancelledRef.current) return;
        setProfile(null);
        setRoles([]);
      }
    };

    // Listen first (covers OAuth redirects), but also proactively hydrate from getSession
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      try {
        setLoading(true);
        await applySession(nextSession);
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    });

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) console.error('Error getting session:', error);
        await applySession(data.session);
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelledRef.current = true;
      subscription.unsubscribe();
    };
  }, []);


  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
  };

  const hasRole = (role: AppRole) => roles.includes(role);

  return (
    <AuthContext.Provider value={{ user, session, profile, roles, loading, signOut, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
