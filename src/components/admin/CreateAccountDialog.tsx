import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { UserPlus, Copy, Loader2, Eye, EyeOff } from 'lucide-react';
import type { Enums } from '@/integrations/supabase/types';

type AppRole = Enums<'app_role'>;

const ALL_ROLES: { value: AppRole; label: string; description: string }[] = [
  { value: 'provider', label: 'Provider', description: 'Can complete onboarding and view their dashboard' },
  { value: 'physician', label: 'Physician', description: 'Can supervise providers and manage agreements' },
  { value: 'admin', label: 'Admin', description: 'Full access to all system features' },
  { value: 'leadership', label: 'Leadership', description: 'Read-only access to reports and analytics' },
];

interface CreateAccountDialogProps {
  trigger?: React.ReactNode;
}

function generateTemporaryPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

export function CreateAccountDialog({ trigger }: CreateAccountDialogProps) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<AppRole[]>(['provider']);
  const [tempPassword, setTempPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [accountCreated, setAccountCreated] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const createAccountMutation = useMutation({
    mutationFn: async ({ fullName, email, roles }: { fullName: string; email: string; roles: AppRole[] }) => {
      const password = generateTemporaryPassword();
      
      // Create auth user via Supabase Admin API (using edge function)
      const { data: result, error } = await supabase.functions.invoke('admin-create-user', {
        body: { email, password, fullName, roles },
      });

      if (error) throw new Error(error.message);
      if (result?.error) throw new Error(result.error);

      return { password, userId: result.userId };
    },
    onSuccess: (data) => {
      setTempPassword(data.password);
      setAccountCreated(true);
      queryClient.invalidateQueries({ queryKey: ['users-with-roles'] });
      toast({
        title: 'Account Created',
        description: `Account for ${email} has been created successfully.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error Creating Account',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleToggleRole = (role: AppRole) => {
    setSelectedRoles(prev => 
      prev.includes(role) 
        ? prev.filter(r => r !== role)
        : [...prev, role]
    );
  };

  const handleSubmit = () => {
    if (!fullName.trim() || !email.trim()) {
      toast({
        title: 'Missing Information',
        description: 'Please provide a name and email address.',
        variant: 'destructive',
      });
      return;
    }

    if (selectedRoles.length === 0) {
      toast({
        title: 'No Role Selected',
        description: 'Please select at least one role.',
        variant: 'destructive',
      });
      return;
    }

    createAccountMutation.mutate({ fullName, email, roles: selectedRoles });
  };

  const handleCopyPassword = () => {
    navigator.clipboard.writeText(tempPassword);
    toast({
      title: 'Copied',
      description: 'Temporary password copied to clipboard.',
    });
  };

  const handleClose = () => {
    setOpen(false);
    // Reset form after close animation
    setTimeout(() => {
      setFullName('');
      setEmail('');
      setSelectedRoles(['provider']);
      setTempPassword('');
      setAccountCreated(false);
      setShowPassword(false);
    }, 150);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => isOpen ? setOpen(true) : handleClose()}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <UserPlus className="h-4 w-4 mr-2" />
            Create Account
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {accountCreated ? 'Account Created' : 'Create New Account'}
          </DialogTitle>
          <DialogDescription>
            {accountCreated 
              ? 'Share the temporary password with the user. They will be prompted to change it on first login.'
              : 'Create a new user account and assign roles. A temporary password will be generated.'
            }
          </DialogDescription>
        </DialogHeader>

        {accountCreated ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <div className="text-sm font-medium">{email}</div>
            </div>
            <div className="space-y-2">
              <Label>Temporary Password</Label>
              <div className="flex items-center gap-2">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={tempPassword}
                  readOnly
                  className="font-mono"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopyPassword}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The user will be required to change this password upon first login.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Assigned Roles</Label>
              <div className="flex flex-wrap gap-1">
                {selectedRoles.map(role => (
                  <span
                    key={role}
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary"
                  >
                    {role}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane.doe@example.com"
              />
            </div>
            <div className="space-y-3">
              <Label>Assign Roles</Label>
              {ALL_ROLES.map(role => (
                <div key={role.value} className="flex items-start space-x-3">
                  <Checkbox
                    id={`role-${role.value}`}
                    checked={selectedRoles.includes(role.value)}
                    onCheckedChange={() => handleToggleRole(role.value)}
                  />
                  <div className="grid gap-0.5">
                    <label
                      htmlFor={`role-${role.value}`}
                      className="text-sm font-medium leading-none cursor-pointer"
                    >
                      {role.label}
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {role.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          {accountCreated ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button 
                onClick={handleSubmit}
                disabled={createAccountMutation.isPending}
              >
                {createAccountMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Create Account
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
