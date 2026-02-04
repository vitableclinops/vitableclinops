import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { LicenseTypeBadge } from '@/components/LicenseTypeBadge';
import { cn } from '@/lib/utils';
import type { Task } from '@/types';
import { 
  Clock, 
  DollarSign, 
  ChevronRight,
  FileText,
  MessageSquare
} from 'lucide-react';

interface TaskCardProps {
  task: Task;
  stateName?: string;
  showState?: boolean;
  onClick?: () => void;
  className?: string;
}

export function TaskCard({ task, stateName, showState = false, onClick, className }: TaskCardProps) {
  const hasEvidence = task.evidence.length > 0;
  const hasNotes = task.notes.length > 0;

  return (
    <Card 
      className={cn(
        'card-interactive cursor-pointer group',
        task.status === 'blocked' && 'border-destructive/30',
        className
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <StatusBadge status={task.status} size="sm" />
              <LicenseTypeBadge type={task.licenseType} />
              {showState && stateName && (
                <span className="text-xs font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                  {stateName}
                </span>
              )}
            </div>
            
            {/* Title and description */}
            <h4 className="font-medium text-foreground mt-2">{task.title}</h4>
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
              {task.description}
            </p>

            {/* Meta info */}
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                <span>{task.estimatedTimeMinutes} min</span>
              </div>
              {task.estimatedFee > 0 && (
                <div className="flex items-center gap-1">
                  <DollarSign className="h-3.5 w-3.5" />
                  <span>${task.estimatedFee}</span>
                </div>
              )}
              {hasEvidence && (
                <div className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  <span>{task.evidence.length} file{task.evidence.length > 1 ? 's' : ''}</span>
                </div>
              )}
              {hasNotes && (
                <div className="flex items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>{task.notes.length}</span>
                </div>
              )}
            </div>
          </div>

          <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
        </div>
      </CardContent>
    </Card>
  );
}
