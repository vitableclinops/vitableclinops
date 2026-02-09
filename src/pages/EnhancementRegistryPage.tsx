import { useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Lightbulb, Plus, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useEnhancements, useCreateEnhancement, useUpdateEnhancement, type Enhancement } from '@/hooks/useEnhancementRegistry';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const categoryColors: Record<string, string> = {
  workflow: 'bg-primary/10 text-primary border-primary/30',
  integration: 'bg-accent/10 text-accent-foreground border-accent/30',
  ai: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
  general: 'bg-muted text-muted-foreground',
};

const priorityColors: Record<string, string> = {
  high: 'bg-destructive/10 text-destructive border-destructive/30',
  medium: 'bg-warning/10 text-warning border-warning/30',
  low: 'bg-muted text-muted-foreground',
};

const statusLabels: Record<string, string> = {
  proposed: 'Proposed',
  planned: 'Planned',
  in_progress: 'In Progress',
  completed: 'Completed',
  deferred: 'Deferred',
};

export default function EnhancementRegistryPage() {
  const { profile, roles } = useAuth();
  const { data: enhancements, isLoading } = useEnhancements();
  const createEnhancement = useCreateEnhancement();
  const updateEnhancement = useUpdateEnhancement();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState('general');
  const [newPriority, setNewPriority] = useState('medium');

  const handleCreate = () => {
    createEnhancement.mutate({
      title: newTitle,
      description: newDescription,
      category: newCategory,
      priority: newPriority,
      requested_by: profile?.full_name || profile?.email,
    }, {
      onSuccess: () => {
        setDialogOpen(false);
        setNewTitle('');
        setNewDescription('');
        setNewCategory('general');
        setNewPriority('medium');
      },
    });
  };

  const userRole = roles[0] || 'admin';
  const userName = profile?.full_name || profile?.email || 'User';
  const userEmail = profile?.email || '';

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar userRole={userRole} userName={userName} userEmail={userEmail} userAvatarUrl={profile?.avatar_url || undefined} />
      <main className="ml-16 lg:ml-64 transition-all duration-300 min-w-0">
        <div className="p-4 md:p-6 lg:p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Lightbulb className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">Enhancement Registry</h1>
                <p className="text-muted-foreground">Future enhancements roadmap — no execution logic, visibility only</p>
              </div>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2" />Add Enhancement</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Enhancement</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div><Label>Title</Label><Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Enhancement title" /></div>
                  <div><Label>Description</Label><Textarea value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="Describe the enhancement..." /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Category</Label>
                      <Select value={newCategory} onValueChange={setNewCategory}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="workflow">Workflow</SelectItem>
                          <SelectItem value="integration">Integration</SelectItem>
                          <SelectItem value="ai">AI</SelectItem>
                          <SelectItem value="general">General</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Priority</Label>
                      <Select value={newPriority} onValueChange={setNewPriority}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleCreate} disabled={!newTitle || createEnhancement.isPending}>
                    {createEnhancement.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Add
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              {enhancements?.map(item => (
                <Card key={item.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium">{item.title}</h3>
                          <Badge variant="outline" className={cn('text-xs', categoryColors[item.category] || categoryColors.general)}>
                            {item.category}
                          </Badge>
                          <Badge variant="outline" className={cn('text-xs', priorityColors[item.priority] || priorityColors.medium)}>
                            {item.priority}
                          </Badge>
                        </div>
                        {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
                        <p className="text-xs text-muted-foreground mt-2">
                          Added {format(new Date(item.created_at), 'MMM d, yyyy')}
                          {item.requested_by && ` by ${item.requested_by}`}
                        </p>
                      </div>
                      <Select
                        value={item.status}
                        onValueChange={(newStatus) => updateEnhancement.mutate({ id: item.id, status: newStatus })}
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(statusLabels).map(([val, label]) => (
                            <SelectItem key={val} value={val}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {(!enhancements || enhancements.length === 0) && (
                <Card><CardContent className="py-8 text-center text-muted-foreground">No enhancements registered yet</CardContent></Card>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
