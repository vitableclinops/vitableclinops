import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateCalendarEvent, useUpdateCalendarEvent, type CalendarEvent } from '@/hooks/useCalendarEvents';
import { useKBArticles } from '@/hooks/useKnowledgeBase';
import { Loader2, Calendar, Link, Video, FileText } from 'lucide-react';

interface AllHandsEventFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: CalendarEvent | null;
}

export function AllHandsEventForm({ open, onOpenChange, event }: AllHandsEventFormProps) {
  const [title, setTitle] = useState(event?.title || 'Provider All-Hands');
  const [description, setDescription] = useState(event?.description || '');
  const [startsAt, setStartsAt] = useState(
    event?.starts_at 
      ? new Date(event.starts_at).toISOString().slice(0, 16) 
      : ''
  );
  const [duration, setDuration] = useState(60);
  const [meetingLink, setMeetingLink] = useState(event?.meeting_link || '');
  const [recordingLink, setRecordingLink] = useState(event?.recording_link || '');
  const [newsletterArticleId, setNewsletterArticleId] = useState(event?.newsletter_article_id || '');
  const [attestationRequired, setAttestationRequired] = useState(event?.attestation_required ?? true);
  const [attestationDueDays, setAttestationDueDays] = useState(event?.attestation_due_days || 7);

  const createMutation = useCreateCalendarEvent();
  const updateMutation = useUpdateCalendarEvent();
  const { data: articles } = useKBArticles();

  const isEditing = !!event;
  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = async () => {
    if (!startsAt) return;

    const startDate = new Date(startsAt);
    const endDate = new Date(startDate);
    endDate.setMinutes(endDate.getMinutes() + duration);

    const payload = {
      title,
      description: description || undefined,
      event_type: 'provider_all_hands',
      starts_at: startDate.toISOString(),
      ends_at: endDate.toISOString(),
      timezone: 'America/Chicago',
      meeting_link: meetingLink || undefined,
      recording_link: recordingLink || undefined,
      newsletter_article_id: newsletterArticleId || undefined,
      attestation_required: attestationRequired,
      attestation_due_days: attestationDueDays,
    };

    if (isEditing) {
      await updateMutation.mutateAsync({ id: event.id, ...payload });
    } else {
      await createMutation.mutateAsync(payload);
    }

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            {isEditing ? 'Edit All-Hands Event' : 'Create Provider All-Hands'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Event Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Provider All-Hands"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Agenda and notes..."
              className="h-20"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startsAt">Date & Time (CT)</Label>
              <Input
                id="startsAt"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="duration">Duration (minutes)</Label>
              <Input
                id="duration"
                type="number"
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value) || 60)}
                min={15}
                step={15}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="meetingLink" className="flex items-center gap-2">
              <Video className="h-4 w-4" />
              Meeting Link
            </Label>
            <Input
              id="meetingLink"
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
              placeholder="https://zoom.us/j/..."
            />
          </div>

          {isEditing && (
            <>
              <div className="space-y-2">
                <Label htmlFor="recordingLink" className="flex items-center gap-2">
                  <Link className="h-4 w-4" />
                  Recording Link
                </Label>
                <Input
                  id="recordingLink"
                  value={recordingLink}
                  onChange={(e) => setRecordingLink(e.target.value)}
                  placeholder="https://..."
                />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Newsletter Article
                </Label>
                <Select value={newsletterArticleId} onValueChange={setNewsletterArticleId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select newsletter article..." />
                  </SelectTrigger>
                  <SelectContent>
                    {articles?.map(article => (
                      <SelectItem key={article.id} value={article.id}>
                        {article.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div>
              <Label htmlFor="attestation" className="font-medium">
                Require Attestation
              </Label>
              <p className="text-xs text-muted-foreground">
                Providers must attest they reviewed the recording
              </p>
            </div>
            <Switch
              id="attestation"
              checked={attestationRequired}
              onCheckedChange={setAttestationRequired}
            />
          </div>

          {attestationRequired && (
            <div className="space-y-2">
              <Label htmlFor="dueDays">Attestation Due (days after event)</Label>
              <Input
                id="dueDays"
                type="number"
                value={attestationDueDays}
                onChange={(e) => setAttestationDueDays(parseInt(e.target.value) || 7)}
                min={1}
                max={30}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !startsAt}>
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEditing ? 'Save Changes' : 'Create Event'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
