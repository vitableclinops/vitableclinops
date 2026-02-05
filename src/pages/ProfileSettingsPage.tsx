import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { ArrowLeft, Camera, Loader2, User, Key, Phone, FileText, Home, Heart, CalendarIcon, Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExtendedProfile {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  phone_number: string | null;
  npi_number: string | null;
  credentials: string | null;
  birthday: string | null;
  home_address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  preferred_name: string | null;
  patient_age_preference: string | null;
  service_offerings: string | null;
  employment_start_date: string | null;
  employment_end_date: string | null;
  employment_status: string | null;
}

const ProfileSettingsPage = () => {
  const navigate = useNavigate();
  const { user, profile, roles } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Basic info
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [npiNumber, setNpiNumber] = useState('');
  const [credentials, setCredentials] = useState('');
  
  // New extended fields
  const [preferredName, setPreferredName] = useState('');
  const [birthday, setBirthday] = useState<Date | undefined>(undefined);
  const [homeAddress, setHomeAddress] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');
  const [patientAgePreference, setPatientAgePreference] = useState('');
  const [serviceOfferings, setServiceOfferings] = useState('');
  
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const userRole = roles[0] || 'provider';
  const userName = profile?.full_name || profile?.email || 'User';
  const userEmail = profile?.email || '';

  // Load full profile data on mount
  useEffect(() => {
    const loadFullProfile = async () => {
      if (!user) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (data && !error) {
        const p = data as ExtendedProfile;
        setFullName(p.full_name || '');
        setAvatarUrl(p.avatar_url || '');
        setPhoneNumber(p.phone_number || '');
        setNpiNumber(p.npi_number || '');
        setCredentials(p.credentials || '');
        setPreferredName(p.preferred_name || '');
        setBirthday(p.birthday ? new Date(p.birthday) : undefined);
        setHomeAddress(p.home_address || '');
        setEmergencyContactName(p.emergency_contact_name || '');
        setEmergencyContactPhone(p.emergency_contact_phone || '');
        setPatientAgePreference(p.patient_age_preference || '');
        setServiceOfferings(p.service_offerings || '');
      }
    };

    loadFullProfile();
  }, [user]);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload an image file.',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please upload an image smaller than 5MB.',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/avatar.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      const urlWithCacheBuster = `${publicUrl}?t=${Date.now()}`;
      setAvatarUrl(urlWithCacheBuster);

      toast({
        title: 'Avatar uploaded',
        description: 'Your avatar has been uploaded. Click Save to apply changes.',
      });
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: 'Upload failed',
        description: error.message || 'Failed to upload avatar.',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;

    setIsSaving(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName,
          avatar_url: avatarUrl,
          phone_number: phoneNumber || null,
          npi_number: npiNumber || null,
          credentials: credentials || null,
          preferred_name: preferredName || null,
          birthday: birthday ? birthday.toISOString().split('T')[0] : null,
          home_address: homeAddress || null,
          emergency_contact_name: emergencyContactName || null,
          emergency_contact_phone: emergencyContactPhone || null,
          patient_age_preference: patientAgePreference || null,
          service_offerings: serviceOfferings || null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: 'Profile updated',
        description: 'Your profile has been saved successfully.',
      });

      window.location.reload();
    } catch (error: any) {
      console.error('Save error:', error);
      toast({
        title: 'Save failed',
        description: error.message || 'Failed to save profile.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!newPassword || !confirmPassword) {
      toast({
        title: 'Missing fields',
        description: 'Please fill in both password fields.',
        variant: 'destructive',
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: 'Passwords do not match',
        description: 'Please make sure both passwords match.',
        variant: 'destructive',
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: 'Password too short',
        description: 'Password must be at least 6 characters.',
        variant: 'destructive',
      });
      return;
    }

    setIsChangingPassword(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      toast({
        title: 'Password updated',
        description: 'Your password has been changed successfully.',
      });

      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      console.error('Password change error:', error);
      toast({
        title: 'Password change failed',
        description: error.message || 'Failed to change password.',
        variant: 'destructive',
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar 
        userRole={userRole as any}
        userName={userName}
        userEmail={userEmail}
        userAvatarUrl={profile?.avatar_url || undefined}
      />
      
      <main className="pl-64 transition-all duration-300">
        <div className="p-8">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Profile Settings</h1>
              <p className="text-muted-foreground">Manage your account information</p>
            </div>
          </div>

          <div className="max-w-2xl space-y-6">
            {/* Personal Information Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Personal Information
                </CardTitle>
                <CardDescription>
                  Update your profile photo and display name
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Avatar Upload */}
                <div className="flex items-center gap-6">
                  <div className="relative">
                    <Avatar className="h-24 w-24 cursor-pointer" onClick={handleAvatarClick}>
                      <AvatarImage src={avatarUrl} alt={fullName || 'Avatar'} />
                      <AvatarFallback className="text-lg bg-primary/10 text-primary">
                        {fullName ? getInitials(fullName) : <User className="h-8 w-8" />}
                      </AvatarFallback>
                    </Avatar>
                    <button
                      onClick={handleAvatarClick}
                      disabled={isUploading}
                      className="absolute bottom-0 right-0 p-2 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {isUploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Camera className="h-4 w-4" />
                      )}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-foreground">Profile Photo</h3>
                    <p className="text-sm text-muted-foreground">
                      Click the avatar to upload a new photo. Max size: 5MB.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Display Name */}
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Full Name</Label>
                    <Input
                      id="fullName"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Enter your full name"
                    />
                  </div>

                  {/* Preferred Name */}
                  <div className="space-y-2">
                    <Label htmlFor="preferredName">Preferred Name</Label>
                    <Input
                      id="preferredName"
                      value={preferredName}
                      onChange={(e) => setPreferredName(e.target.value)}
                      placeholder="What should we call you?"
                    />
                  </div>
                </div>

                {/* Birthday */}
                <div className="space-y-2">
                  <Label>Birthday</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          'w-full justify-start text-left font-normal',
                          !birthday && 'text-muted-foreground'
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {birthday ? format(birthday, 'PPP') : 'Pick a date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={birthday}
                        onSelect={setBirthday}
                        captionLayout="dropdown-buttons"
                        fromYear={1940}
                        toYear={new Date().getFullYear()}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Email (Read-only) */}
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    value={userEmail}
                    disabled
                    className="bg-muted"
                  />
                  <p className="text-sm text-muted-foreground">
                    Your email address cannot be changed.
                  </p>
                </div>

                {/* Roles (Read-only) */}
                <div className="space-y-2">
                  <Label>Assigned Roles</Label>
                  <div className="flex flex-wrap gap-2">
                    {roles.map((role) => (
                      <span
                        key={role}
                        className="px-3 py-1 rounded-full text-sm font-medium bg-primary/10 text-primary capitalize"
                      >
                        {role}
                      </span>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Address & Emergency Contact */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Home className="h-5 w-5" />
                  Address & Emergency Contact
                </CardTitle>
                <CardDescription>
                  Your home address and emergency contact information
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Home Address */}
                <div className="space-y-2">
                  <Label htmlFor="homeAddress">Home Address</Label>
                  <Textarea
                    id="homeAddress"
                    value={homeAddress}
                    onChange={(e) => setHomeAddress(e.target.value)}
                    placeholder="123 Main St, City, State ZIP"
                    rows={2}
                  />
                </div>

                {/* Emergency Contact */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="emergencyName" className="flex items-center gap-2">
                      <Heart className="h-4 w-4" />
                      Emergency Contact Name
                    </Label>
                    <Input
                      id="emergencyName"
                      value={emergencyContactName}
                      onChange={(e) => setEmergencyContactName(e.target.value)}
                      placeholder="Contact name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="emergencyPhone">Emergency Contact Phone</Label>
                    <Input
                      id="emergencyPhone"
                      type="tel"
                      value={emergencyContactPhone}
                      onChange={(e) => setEmergencyContactPhone(e.target.value)}
                      placeholder="(555) 123-4567"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Provider Information Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Professional Information
                </CardTitle>
                <CardDescription>
                  Professional details for credentialing purposes
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Phone Number */}
                <div className="space-y-2">
                  <Label htmlFor="phone" className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    Phone Number
                  </Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="(555) 123-4567"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* NPI Number */}
                  <div className="space-y-2">
                    <Label htmlFor="npi">NPI Number</Label>
                    <Input
                      id="npi"
                      value={npiNumber}
                      onChange={(e) => setNpiNumber(e.target.value)}
                      placeholder="10-digit NPI"
                      maxLength={10}
                    />
                  </div>

                  {/* Credentials */}
                  <div className="space-y-2">
                    <Label htmlFor="credentials">Credentials</Label>
                    <Input
                      id="credentials"
                      value={credentials}
                      onChange={(e) => setCredentials(e.target.value)}
                      placeholder="e.g., NP, RN, MSN"
                    />
                  </div>
                </div>

                {/* Patient Age Preference */}
                <div className="space-y-2">
                  <Label htmlFor="patientAge">Patient Age Preference</Label>
                  <Select value={patientAgePreference} onValueChange={setPatientAgePreference}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select age preference" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pediatric">Pediatric (0-17)</SelectItem>
                      <SelectItem value="adult">Adult (18-64)</SelectItem>
                      <SelectItem value="geriatric">Geriatric (65+)</SelectItem>
                      <SelectItem value="all_ages">All Ages</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Service Offerings */}
                <div className="space-y-2">
                  <Label htmlFor="services">Service Offerings</Label>
                  <Textarea
                    id="services"
                    value={serviceOfferings}
                    onChange={(e) => setServiceOfferings(e.target.value)}
                    placeholder="Primary care, Mental health, Women's health..."
                    rows={2}
                  />
                  <p className="text-xs text-muted-foreground">
                    List the services you provide, separated by commas.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Save Button */}
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={isSaving} size="lg">
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>

            <Separator />

            {/* Password Change Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5" />
                  Change Password
                </CardTitle>
                <CardDescription>
                  Update your account password
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* New Password */}
                <div className="space-y-2">
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                  />
                </div>

                {/* Confirm Password */}
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                  />
                  <p className="text-sm text-muted-foreground">
                    Password must be at least 6 characters.
                  </p>
                </div>

                {/* Change Password Button */}
                <div className="flex justify-end">
                  <Button 
                    onClick={handlePasswordChange} 
                    disabled={isChangingPassword || !newPassword || !confirmPassword}
                    variant="outline"
                  >
                    {isChangingPassword ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      'Update Password'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ProfileSettingsPage;