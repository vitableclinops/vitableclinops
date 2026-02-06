import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Shield, Users, ArrowLeft, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { CreateAccountDialog } from '@/components/admin/CreateAccountDialog';
import type { Tables, Enums } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'>;
type AppRole = Enums<'app_role'>;

const ALL_ROLES: AppRole[] = ['admin', 'provider', 'physician', 'leadership'];

const ROLE_COLORS: Record<AppRole, string> = {
  admin: 'bg-red-100 text-red-800 border-red-200',
  provider: 'bg-blue-100 text-blue-800 border-blue-200',
  physician: 'bg-green-100 text-green-800 border-green-200',
  leadership: 'bg-purple-100 text-purple-800 border-purple-200',
};

interface UserWithRoles extends Profile {
  roles: AppRole[];
}

export default function UserRolesPage() {
  const { toast } = useToast();
  const { profile, roles } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [updatingUser, setUpdatingUser] = useState<string | null>(null);

  const userRole = roles[0] || 'provider';
  const userName = profile?.full_name || profile?.email || 'User';
  const userEmail = profile?.email || '';

  const { data: usersWithRoles, isLoading } = useQuery({
    queryKey: ['users-with-roles'],
    queryFn: async () => {
      // Fetch all profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Fetch all user roles
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('*');

      if (rolesError) throw rolesError;

      // Combine profiles with their roles
      const usersMap = new Map<string, UserWithRoles>();
      
      profiles?.forEach(profile => {
        usersMap.set(profile.user_id, {
          ...profile,
          roles: [],
        });
      });

      userRoles?.forEach(role => {
        const user = usersMap.get(role.user_id);
        if (user) {
          user.roles.push(role.role as AppRole);
        }
      });

      return Array.from(usersMap.values());
    },
  });

  const toggleRoleMutation = useMutation({
    mutationFn: async ({ userId, role, hasRole }: { userId: string; role: AppRole; hasRole: boolean }) => {
      if (hasRole) {
        // Remove role
        const { error } = await supabase
          .from('user_roles')
          .delete()
          .eq('user_id', userId)
          .eq('role', role);
        if (error) throw error;
      } else {
        // Add role
        const { error } = await supabase
          .from('user_roles')
          .insert({ user_id: userId, role });
        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users-with-roles'] });
      toast({
        title: variables.hasRole ? 'Role removed' : 'Role added',
        description: `Successfully ${variables.hasRole ? 'removed' : 'added'} ${variables.role} role.`,
      });
      setUpdatingUser(null);
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      setUpdatingUser(null);
    },
  });

  const handleToggleRole = (userId: string, role: AppRole, hasRole: boolean) => {
    setUpdatingUser(`${userId}-${role}`);
    toggleRoleMutation.mutate({ userId, role, hasRole });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar userRole={userRole} userName={userName} userEmail={userEmail} userAvatarUrl={profile?.avatar_url || undefined} />
      
      <main className="flex-1 ml-64 p-6">
        <div className="mb-6">
          <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold">User Role Management</h1>
            </div>
            <CreateAccountDialog />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              All Users
            </CardTitle>
            <CardDescription>
              Manage user roles across the platform. Check/uncheck roles to grant or revoke access.
            </CardDescription>
          </CardHeader>
          <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : !usersWithRoles?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  No users found.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Current Roles</TableHead>
                      {ALL_ROLES.map(role => (
                        <TableHead key={role} className="text-center capitalize">
                          {role}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usersWithRoles.map(user => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">
                          {user.full_name || 'No name'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {user.email}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {user.roles.length > 0 ? (
                              user.roles.map(role => (
                                <Badge
                                  key={role}
                                  variant="outline"
                                  className={ROLE_COLORS[role]}
                                >
                                  {role}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-muted-foreground text-sm">No roles</span>
                            )}
                          </div>
                        </TableCell>
                        {ALL_ROLES.map(role => {
                          const hasRole = user.roles.includes(role);
                          const isUpdating = updatingUser === `${user.user_id}-${role}`;
                          
                          return (
                            <TableCell key={role} className="text-center">
                              {isUpdating ? (
                                <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                              ) : (
                                <Checkbox
                                  checked={hasRole}
                                  onCheckedChange={() => handleToggleRole(user.user_id, role, hasRole)}
                                  aria-label={`Toggle ${role} role for ${user.email}`}
                                />
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
