import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { User, Mail, Hash, AlertCircle, Camera, FileText, Baby } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PROVIDER_TYPE_CONFIG } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { OnboardingData } from './OnboardingWizard';

interface WelcomeStepProps {
  mode: 'new' | 'edit' | 'admin';
  data: OnboardingData;
  onUpdate: (updates: Partial<OnboardingData>) => void;
}

export function WelcomeStep({ mode, data, onUpdate }: WelcomeStepProps) {
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();
  const isReadOnly = mode === 'edit';
  const requiresNPI = data.providerType && PROVIDER_TYPE_CONFIG[data.providerType].requiresNPI;

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload an image file.',
        variant: 'destructive',
      });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please upload an image smaller than 5MB.',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${data.providerId || 'temp'}-${Date.now()}.${fileExt}`;
      const filePath = `headshots/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      onUpdate({ avatarUrl: urlData.publicUrl });
      toast({
        title: 'Photo uploaded',
        description: 'Your headshot has been uploaded successfully.',
      });
    } catch (error) {
      console.error('Error uploading avatar:', error);
      toast({
        title: 'Upload failed',
        description: 'Failed to upload photo. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
          <User className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">
          {mode === 'new' ? 'Your Profile' : 'Confirm Your Information'}
        </h2>
        <p className="text-muted-foreground mt-2">
          {mode === 'new' 
            ? 'Complete your profile to get started.'
            : 'Please verify your information is correct before continuing.'}
        </p>
      </div>

      {mode === 'edit' && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            To change your name, email, or NPI number, please contact Clinical Operations.
          </AlertDescription>
        </Alert>
      )}

      {/* Avatar / Headshot Upload */}
      <div className="flex flex-col items-center gap-4 pb-4 border-b">
        <Avatar className="h-24 w-24">
          <AvatarImage src={data.avatarUrl} alt={data.providerName} />
          <AvatarFallback className="text-lg">
            {data.providerName ? getInitials(data.providerName) : <User className="h-8 w-8" />}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col items-center gap-2">
          <Label htmlFor="avatar-upload" className="cursor-pointer">
            <Button variant="outline" size="sm" asChild disabled={uploading}>
              <span>
                <Camera className="h-4 w-4 mr-2" />
                {uploading ? 'Uploading...' : data.avatarUrl ? 'Change Photo' : 'Upload Headshot'}
              </span>
            </Button>
          </Label>
          <input
            id="avatar-upload"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarUpload}
            disabled={uploading}
          />
          <p className="text-xs text-muted-foreground">
            Professional headshot recommended (max 5MB)
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="providerName" className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            Full Name
          </Label>
          <Input
            id="providerName"
            placeholder="Jane Smith"
            value={data.providerName}
            onChange={(e) => onUpdate({ providerName: e.target.value })}
            disabled={isReadOnly}
            className={isReadOnly ? 'bg-muted' : ''}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="providerEmail" className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            Email Address
          </Label>
          <Input
            id="providerEmail"
            type="email"
            placeholder="jane.smith@company.com"
            value={data.providerEmail}
            onChange={(e) => onUpdate({ providerEmail: e.target.value })}
            disabled={isReadOnly}
            className={isReadOnly ? 'bg-muted' : ''}
          />
        </div>

        {requiresNPI && (
          <div className="space-y-2">
            <Label htmlFor="npiNumber" className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-muted-foreground" />
              NPI Number
            </Label>
            <Input
              id="npiNumber"
              placeholder="1234567890"
              value={data.npiNumber}
              onChange={(e) => onUpdate({ npiNumber: e.target.value })}
              disabled={isReadOnly}
              className={isReadOnly ? 'bg-muted' : ''}
              maxLength={10}
            />
            <p className="text-xs text-muted-foreground">
              Your 10-digit National Provider Identifier
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="minPatientAge" className="flex items-center gap-2">
            <Baby className="h-4 w-4 text-muted-foreground" />
            Minimum Patient Age
          </Label>
          <Select
            value={data.minPatientAge || ''}
            onValueChange={(value) => onUpdate({ minPatientAge: value })}
          >
            <SelectTrigger id="minPatientAge">
              <SelectValue placeholder="Select minimum age" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1.5">1.5+ years (Toddlers and up)</SelectItem>
              <SelectItem value="13">13+ years (Adolescents and up)</SelectItem>
              <SelectItem value="17">17+ years (Adults only)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The youngest patient age you're comfortable treating
          </p>
        </div>
      </div>

      {/* Bio Section */}
      <div className="space-y-2">
        <Label htmlFor="providerBio" className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          Professional Bio
        </Label>
        <Textarea
          id="providerBio"
          placeholder="Tell us about your background, specialties, and approach to patient care..."
          value={data.bio || ''}
          onChange={(e) => onUpdate({ bio: e.target.value })}
          rows={4}
          className="resize-none"
        />
        <p className="text-xs text-muted-foreground">
          This bio may be shared with patients and on the company website
        </p>
      </div>

      {mode === 'new' && data.providerType && (
        <Card className="bg-muted/50 border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">What happens next?</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            {PROVIDER_TYPE_CONFIG[data.providerType].requiresLicensure ? (
              <>
                <p>1. <strong>Select your states</strong> — Choose the states where you want to practice</p>
                <p>2. <strong>Report existing licenses</strong> — Tell us about licenses you already hold</p>
                <p>3. <strong>Review and submit</strong> — Clinical Operations will verify your information</p>
              </>
            ) : (
              <>
                <p>1. <strong>Review your info</strong> — Confirm everything looks correct</p>
                <p>2. <strong>Complete onboarding</strong> — You'll be assigned compliance training</p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
