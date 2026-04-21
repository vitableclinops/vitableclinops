import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { TaskDialog, type TaskDialogTask } from '@/components/tasks/TaskDialog';
import type { UserRole } from '@/types';

const TaskDetailView = () => {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();
  const { profile, roles } = useAuth();
  const [task, setTask] = useState<TaskDialogTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(true);

  const userRole = (roles[0] || 'admin') as UserRole;
  const userName = profile?.full_name || profile?.email || '';
  const userEmail = profile?.email || '';
  const isAdmin = roles.includes('admin');

  useEffect(() => {
    if (!taskId) {
      setError('No task specified');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error: fetchErr } = await supabase
        .from('agreement_tasks')
        .select('*')
        .eq('id', taskId)
        .maybeSingle();
      if (cancelled) return;
      if (fetchErr) {
        setError(fetchErr.message);
      } else if (!data) {
        setError('Task not found');
      } else {
        setTask(data as TaskDialogTask);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // When dialog closes, navigate back
  useEffect(() => {
    if (!dialogOpen && !loading && task) {
      navigate(-1);
    }
  }, [dialogOpen, loading, task, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        userRole={userRole}
        userName={userName}
        userEmail={userEmail}
        userAvatarUrl={profile?.avatar_url || undefined}
      />
      <main className="ml-0 sm:ml-16 lg:ml-64 transition-all duration-300">
        <div className="p-8 max-w-4xl">
          <Button
            variant="ghost"
            className="mb-6 -ml-2"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          {loading && (
            <Card>
              <CardContent className="py-12 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading task…
              </CardContent>
            </Card>
          )}

          {!loading && error && (
            <Card>
              <CardContent className="py-12 text-center space-y-3">
                <AlertTriangle className="h-8 w-8 text-warning mx-auto" />
                <p className="text-foreground font-medium">{error}</p>
                <p className="text-sm text-muted-foreground">
                  The task may have been archived or removed.
                </p>
                <div className="flex justify-center gap-2 pt-2">
                  <Button variant="outline" onClick={() => navigate('/admin/tasks')}>
                    Open Task Repository
                  </Button>
                  <Button onClick={() => navigate(-1)}>Go Back</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {!loading && task && (
            <TaskDialog
              task={task}
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              isAdmin={isAdmin}
              onTaskUpdated={() => {
                // re-fetch to reflect updates
                if (!taskId) return;
                supabase
                  .from('agreement_tasks')
                  .select('*')
                  .eq('id', taskId)
                  .maybeSingle()
                  .then(({ data }) => {
                    if (data) setTask(data as TaskDialogTask);
                  });
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default TaskDetailView;
