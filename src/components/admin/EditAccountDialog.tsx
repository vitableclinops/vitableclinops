import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface EditAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: {
    user_id: string;
    full_name: string | null;
    email: string | null;
  } | null;
}

export function EditAccountDialog({ open, onOpenChange, user }: EditAccountDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (user) {
      setFullName(user.full_name || '');
      setEmail(user.email || '');
    }
  }, [user]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('No user selected');
      const payload: Record<string, unknown> = { userId: user.user_id };
      if (fullName.trim() !== (user.full_name || '')) payload.fullName = fullName.trim();
      if (email.trim() !== (user.email || '')) payload.email = email.trim();

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
            Update name and email for this user. Email changes apply immediately and are auto-confirmed.
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
