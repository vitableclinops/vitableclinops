import { MessageSquare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { extractProviderNotes, type ProviderNotes } from '@/lib/scheduling/submissionDiff';

/**
 * Renders the free-text Jotform fields ("Comments" and "Feedback") if
 * they have meaningful content. Hidden entirely otherwise.
 *
 * Used in the resubmission inbox dialog and the By Provider expand panel.
 * These fields are where providers surface operationally-important context
 * the structured form fields can't capture (cancellation requests, out-of-
 * band approvals, conflicts with other jobs, etc.).
 */
export function ProviderNotesCard({
  parsedShifts,
  variant = 'card',
  title = "Provider's note",
}: {
  parsedShifts: unknown;
  variant?: 'card' | 'inline';
  title?: string;
}) {
  const notes = extractProviderNotes(parsedShifts);
  if (!notes.hasContent) return null;

  const body = (
    <div className="space-y-2 text-sm">
      {notes.comments && (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">
            Comments
          </div>
          <p className="whitespace-pre-wrap">{notes.comments}</p>
        </div>
      )}
      {notes.feedback && (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">
            Feedback
          </div>
          <p className="whitespace-pre-wrap">{notes.feedback}</p>
        </div>
      )}
    </div>
  );

  if (variant === 'inline') {
    return (
      <div className="border-l-2 border-blue-300 bg-blue-50/40 pl-3 py-2">
        <div className="text-xs font-medium text-blue-900 mb-1 flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {title}
        </div>
        {body}
      </div>
    );
  }

  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-blue-600" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

/**
 * Small inline indicator for table rows — shows a chip when there's a
 * provider note, nothing when there isn't. Click into the parent row to
 * see the full note.
 */
export function ProviderNoteIndicator({ parsedShifts }: { parsedShifts: unknown }) {
  const notes: ProviderNotes = extractProviderNotes(parsedShifts);
  if (!notes.hasContent) return null;
  return (
    <Badge
      variant="outline"
      className="bg-blue-50 border-blue-200 text-blue-900 font-normal gap-1"
    >
      <MessageSquare className="h-3 w-3" />
      note
    </Badge>
  );
}
