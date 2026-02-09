import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Clock, User, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface ChecklistItem {
  key: string;
  label: string;
  completed: boolean;
  completed_at: string | null;
  completed_by: string | null;
  completed_by_name?: string | null;
}

interface TransferChecklistProps {
  transferId: string;
  checklistItems: ChecklistItem[];
  onUpdate: () => void;
  readOnly?: boolean;
}

export function TransferChecklist({ transferId, checklistItems, onUpdate, readOnly = false }: TransferChecklistProps) {
  const [updating, setUpdating] = useState<string | null>(null);
  const { toast } = useToast();

  const completedCount = checklistItems.filter(i => i.completed).length;
  const totalCount = checklistItems.length;
  const allComplete = completedCount === totalCount;

  const handleToggle = async (item: ChecklistItem) => {
    if (readOnly) return;
    setUpdating(item.key);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', user?.id)
        .maybeSingle();

      const updatedItems = checklistItems.map(i => {
        if (i.key === item.key) {
          return {
            ...i,
            completed: !i.completed,
            completed_at: !i.completed ? new Date().toISOString() : null,
            completed_by: !i.completed ? user?.id : null,
            completed_by_name: !i.completed ? (profile?.full_name || user?.email) : null,
          };
        }
        return i;
      });

      const { error } = await supabase
        .from('agreement_transfers')
        .update({ checklist_items: updatedItems as unknown as any })
        .eq('id', transferId);

      if (error) throw error;
      onUpdate();
      toast({ title: !item.completed ? 'Step completed' : 'Step unmarked' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setUpdating(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Transfer Checklist</CardTitle>
          <Badge variant={allComplete ? 'default' : 'secondary'} className={cn(allComplete && 'bg-success text-success-foreground')}>
            {completedCount}/{totalCount} Complete
          </Badge>
        </div>
        {/* Progress bar */}
        <div className="w-full bg-muted rounded-full h-2 mt-2">
          <div
            className={cn("h-2 rounded-full transition-all", allComplete ? "bg-success" : "bg-primary")}
            style={{ width: `${(completedCount / totalCount) * 100}%` }}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {checklistItems.map(item => (
            <div key={item.key} className={cn(
              "flex items-start gap-3 p-3 rounded-lg border transition-colors",
              item.completed ? "bg-success/5 border-success/20" : "bg-card"
            )}>
              {updating === item.key ? (
                <Loader2 className="h-4 w-4 animate-spin mt-0.5" />
              ) : (
                <Checkbox
                  checked={item.completed}
                  onCheckedChange={() => handleToggle(item)}
                  disabled={readOnly}
                  className="mt-0.5"
                />
              )}
              <div className="flex-1">
                <p className={cn("text-sm", item.completed && "line-through text-muted-foreground")}>
                  {item.label}
                </p>
                {item.completed && item.completed_at && (
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-success" />
                      {format(new Date(item.completed_at), 'MMM d, yyyy HH:mm')}
                    </span>
                    {item.completed_by_name && (
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {item.completed_by_name}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
