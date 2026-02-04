import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { StatusBadge } from '@/components/StatusBadge';
import { LicenseTypeBadge } from '@/components/LicenseTypeBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { currentUser, states } from '@/data/mockData';
import { 
  ArrowLeft,
  Clock,
  DollarSign,
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  MessageSquare,
  ChevronRight,
  ExternalLink,
  Receipt,
  User,
  Calendar
} from 'lucide-react';
import type { Task, Evidence, TaskNote } from '@/types';
import { cn } from '@/lib/utils';

// Get first in-progress task for demo
const demoTask = currentUser.states[0]?.tasks[1] || currentUser.states[0]?.tasks[0];
const demoState = states.find(s => s.id === demoTask?.stateId);

const TaskDetailView = () => {
  const navigate = useNavigate();
  const [newNote, setNewNote] = useState('');
  const task = demoTask;
  const state = demoState;

  if (!task || !state) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Task not found</p>
      </div>
    );
  }

  const isBlocked = task.status === 'blocked';
  const isComplete = ['verified', 'approved'].includes(task.status);
  const canSubmit = task.status === 'in_progress' && task.evidence.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar 
        userRole={currentUser.role}
        userName={`${currentUser.firstName} ${currentUser.lastName}`}
        userEmail={currentUser.email}
      />
      
      <main className="pl-64 transition-all duration-300">
        <div className="p-8 max-w-5xl">
          {/* Back button */}
          <Button
            variant="ghost"
            className="mb-6 -ml-2"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <StatusBadge status={task.status} />
              {task.licenseType && <LicenseTypeBadge type={task.licenseType} />}
              <Badge variant="secondary">{state.abbreviation}</Badge>
            </div>
            
            <h1 className="text-2xl font-bold text-foreground mb-2">
              {task.title}
            </h1>
            <p className="text-muted-foreground">
              {task.description}
            </p>

            {/* Meta info */}
            <div className="flex items-center gap-6 mt-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                <span>Est. {task.estimatedTimeMinutes} minutes</span>
              </div>
              {task.estimatedFee > 0 && (
                <div className="flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4" />
                  <span>~${task.estimatedFee} application fee</span>
                </div>
              )}
              {task.assignedAt && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  <span>Assigned {new Date(task.assignedAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* Blocked warning */}
          {isBlocked && (
            <Card className="mb-6 border-destructive/30 bg-destructive/5">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                  <div>
                    <p className="font-medium text-destructive">This task is blocked</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {task.notes.find(n => n.content.toLowerCase().includes('blocked'))?.content || 
                       'Please review the notes below for more information.'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-8 lg:grid-cols-3">
            {/* Main content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Instructions */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Instructions</CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-4">
                    {task.instructions.map((instruction, index) => (
                      <li key={index} className="flex gap-4">
                        <span className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-medium',
                          isComplete 
                            ? 'bg-success/10 text-success' 
                            : 'bg-primary/10 text-primary'
                        )}>
                          {isComplete ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                        </span>
                        <p className="text-foreground pt-0.5">{instruction}</p>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>

              {/* State-specific notes */}
              {state.notes && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <span className="text-lg">{state.name}</span>
                      <span className="text-muted-foreground font-normal">Notes</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">{state.notes}</p>
                    <div className="flex gap-4 mt-4 text-sm">
                      {state.hasFPA ? (
                        <Badge variant="outline" className="text-success border-success/30">
                          Full Practice Authority Available
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-warning border-warning/30">
                          Requires Collaborative Agreement
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Evidence upload */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Evidence & Documents</CardTitle>
                </CardHeader>
                <CardContent>
                  {/* Upload area */}
                  {!isComplete && (
                    <div className="border-2 border-dashed border-border rounded-lg p-8 text-center mb-6 hover:border-accent transition-colors cursor-pointer">
                      <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                      <p className="font-medium text-foreground">Upload files</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Drag and drop or click to browse
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Confirmation pages, receipts, and documents
                      </p>
                    </div>
                  )}

                  {/* Uploaded files */}
                  {task.evidence.length > 0 ? (
                    <div className="space-y-3">
                      {task.evidence.map((evidence) => (
                        <div 
                          key={evidence.id}
                          className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:shadow-sm transition-shadow"
                        >
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <FileText className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground truncate">
                              {evidence.fileName}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {(evidence.fileSize / 1024).toFixed(1)} KB • Uploaded {new Date(evidence.uploadedAt).toLocaleDateString()}
                            </p>
                          </div>
                          <Badge variant="secondary" className="capitalize">
                            {evidence.type}
                          </Badge>
                          <Button variant="ghost" size="icon">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No files uploaded yet
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Notes and comments */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <MessageSquare className="h-5 w-5" />
                    Notes & Comments
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {/* Add note */}
                  <div className="mb-6">
                    <Textarea
                      placeholder="Add a note or question..."
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      className="mb-3"
                    />
                    <Button disabled={!newNote.trim()}>
                      Add Note
                    </Button>
                  </div>

                  <Separator className="my-6" />

                  {/* Existing notes */}
                  {task.notes.length > 0 ? (
                    <div className="space-y-4">
                      {task.notes.map((note) => (
                        <div key={note.id} className="flex gap-4">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <User className="h-4 w-4 text-primary" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-foreground text-sm">
                                {note.authorName}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(note.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {note.content}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No notes yet
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Action card */}
              <Card className={cn(
                isComplete && 'border-success/30',
                isBlocked && 'border-destructive/30'
              )}>
                <CardContent className="pt-6">
                  {isComplete ? (
                    <div className="text-center">
                      <div className="h-12 w-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3">
                        <CheckCircle2 className="h-6 w-6 text-success" />
                      </div>
                      <p className="font-medium text-success">Task Complete</p>
                      {task.verifiedAt && (
                        <p className="text-sm text-muted-foreground mt-1">
                          Verified {new Date(task.verifiedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <Button 
                        className="w-full mb-3" 
                        disabled={!canSubmit}
                      >
                        Submit for Review
                      </Button>
                      <p className="text-xs text-muted-foreground text-center">
                        {task.evidence.length === 0 
                          ? 'Upload evidence before submitting'
                          : 'Ready to submit for verification'
                        }
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Reimbursement */}
              {(task.estimatedFee > 0 || task.reimbursement) && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Receipt className="h-4 w-4" />
                      Reimbursement
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Application fee</span>
                      <span className="font-medium">${task.reimbursement?.applicationFee || task.estimatedFee}</span>
                    </div>
                    {task.reimbursement && (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Admin time</span>
                          <span className="font-medium">{task.reimbursement.adminTimeMinutes} min</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between">
                          <span className="font-medium">Total</span>
                          <span className="font-bold text-lg">${task.reimbursement.totalAmount.toFixed(2)}</span>
                        </div>
                        <Badge 
                          variant="secondary" 
                          className={cn(
                            'w-full justify-center py-1',
                            task.reimbursement.status === 'pending' && 'bg-warning/10 text-warning',
                            task.reimbursement.status === 'approved' && 'bg-success/10 text-success',
                            task.reimbursement.status === 'processed' && 'bg-success/10 text-success'
                          )}
                        >
                          {task.reimbursement.status === 'pending' && 'Pending Approval'}
                          {task.reimbursement.status === 'approved' && 'Approved'}
                          {task.reimbursement.status === 'processed' && 'Processed'}
                        </Badge>
                      </>
                    )}
                    {!task.reimbursement && !isComplete && (
                      <Button variant="outline" className="w-full" size="sm">
                        <Receipt className="h-4 w-4 mr-2" />
                        Submit Receipt
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Time tracking */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Time Tracking
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Estimated</span>
                    <span className="font-medium">{task.estimatedTimeMinutes} min</span>
                  </div>
                  {task.actualTimeMinutes ? (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Actual</span>
                      <span className="font-medium">{task.actualTimeMinutes} min</span>
                    </div>
                  ) : (
                    <Button variant="outline" className="w-full" size="sm">
                      Log Time
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default TaskDetailView;
