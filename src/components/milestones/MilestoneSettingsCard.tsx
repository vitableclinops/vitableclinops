import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Cake, Trophy, Eye, Loader2 } from 'lucide-react';
import { useUpdateProviderMilestoneSettings, usePods } from '@/hooks/useMilestones';
import { useAuth } from '@/hooks/useAuth';

export function MilestoneSettingsCard() {
  const { profile } = useAuth();
  const { data: pods } = usePods();
  const updateSettings = useUpdateProviderMilestoneSettings();

  const [dateOfBirth, setDateOfBirth] = useState('');
  const [startDate, setStartDate] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [podId, setPodId] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setDateOfBirth((profile as any).date_of_birth || '');
      setStartDate((profile as any).start_date_on_network || '');
      setVisibility((profile as any).milestone_visibility || 'private');
      setPodId((profile as any).pod_id || null);
    }
  }, [profile]);

  const handleSave = () => {
    if (!profile?.id) return;
    
    updateSettings.mutate({
      profileId: profile.id,
      dateOfBirth: dateOfBirth || null,
      startDateOnNetwork: startDate || null,
      milestoneVisibility: visibility,
      podId,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cake className="h-5 w-5" />
          Milestone Settings
        </CardTitle>
        <CardDescription>
          Share your birthday and work anniversary so your pod can celebrate with you
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dob" className="flex items-center gap-2">
              <Cake className="h-4 w-4 text-pink-500" />
              Birthday
            </Label>
            <Input
              id="dob"
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              placeholder="Optional"
            />
            <p className="text-xs text-muted-foreground">
              Your pod lead will be notified a few days before
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="startDate" className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              Start Date
            </Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              placeholder="When you joined"
            />
            <p className="text-xs text-muted-foreground">
              Used for work anniversary celebrations
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="visibility" className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Visibility
          </Label>
          <Select value={visibility} onValueChange={setVisibility}>
            <SelectTrigger id="visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">Private (don't share)</SelectItem>
              <SelectItem value="pod_only">Pod Only (pod lead sees it)</SelectItem>
              <SelectItem value="public">Public (everyone can see)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {pods && pods.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="pod">Your Pod</Label>
            <Select value={podId || ''} onValueChange={(v) => setPodId(v || null)}>
              <SelectTrigger id="pod">
                <SelectValue placeholder="Select your pod" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">No pod assigned</SelectItem>
                {pods.map(pod => (
                  <SelectItem key={pod.id} value={pod.id}>
                    {pod.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Button onClick={handleSave} disabled={updateSettings.isPending}>
          {updateSettings.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save Settings
        </Button>
      </CardContent>
    </Card>
  );
}
