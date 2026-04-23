import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface EditAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: {
    user_id: string;
    full_name: string | null;
    email: string | null;
    profession?: string | null;
  } | null;
}

const PROFESSION_OPTIONS = [
  { value: '__none__', label: 'Not specified' },
  { value: 'MD', label: 'MD (Physician)' },
  { value: 'DO', label: 'DO (Physician)' },
  { value: 'NP', label: 'NP (Nurse Practitioner)' },
  { value: 'RN', label: 'RN (Registered Nurse)' },
  { value: 'LPC', label: 'LPC (Licensed Professional Counselor)' },
  { value: 'mental_health_coach', label: 'Mental Health Coach' },
];

export function EditAccountDialog({ open, onOpenChange, user }: EditAccountDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [profession, setProfession] = useState<string>('__none__');

  useEffect(() => {
    if (user) {
      setFullName(user.full_name || '');
      setEmail(user.email || '');
      setProfession(user.profession || '__none__');
    }
  }, [user]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('No user selected');
      const payload: Record<string, unknown> = { userId: user.user_id };
      if (fullName.trim() !== (user.full_name || '')) payload.fullName = fullName.trim();
      if (email.trim() !== (user.email || '')) payload.email = email.trim();
      const newProfession = profession === '__none__' ? null : profession;
      const currentProfession = user.profession || null;
      if (newProfession !== currentProfession) payload.profession = newProfession;

      if (Object.keys(payload).length === 1) {
        return { skipped: true };
      }

      const { data, error } = await supabase.functions.invoke('admin-update-account', { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data: any) => {
      if (data?.skipped) {
        toast({ title: 'No changes', description: 'Nothing to update.' });
      } else {
        toast({ title: 'Account updated', description: 'Changes saved successfully.' });
        queryClient.invalidateQueries({ queryKey: ['users-with-roles'] });
      }
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Account</DialogTitle>
          <DialogDescription>
            Update name, email, and profession. Selecting MD or DO automatically grants the physician role; switching to a non-physician profession removes it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Full Name</Label>
            <Input id="edit-name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-email">Email</Label>
            <Input id="edit-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-profession">Profession</Label>
            <Select value={profession} onValueChange={setProfession}>
              <SelectTrigger id="edit-profession">
                <SelectValue placeholder="Select profession" />
              </SelectTrigger>
              <SelectContent>
                {PROFESSION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              MD/DO automatically syncs the physician role.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
