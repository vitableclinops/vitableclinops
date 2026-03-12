import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface EditLicenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  license: {
    id: string;
    state_abbreviation: string;
    license_number: string | null;
    license_type: string | null;
    expiration_date: string | null;
    notes: string | null;
    status: string;
  };
  onSaved: () => void;
}

export function EditLicenseDialog({ open, onOpenChange, license, onSaved }: EditLicenseDialogProps) {
  const [licenseNumber, setLicenseNumber] = useState(license.license_number || '');
  const [licenseType, setLicenseType] = useState(license.license_type || 'APRN');
  const [expirationDate, setExpirationDate] = useState(license.expiration_date || '');
  const [notes, setNotes] = useState(license.notes || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('provider_licenses')
        .update({
          license_number: licenseNumber || null,
          license_type: licenseType || null,
          expiration_date: expirationDate || null,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', license.id);

      if (error) throw error;

      toast({ title: 'License Updated', description: `Your ${license.state_abbreviation} license has been updated.` });
      onSaved();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error updating license:', error);
      toast({ title: 'Error', description: 'Failed to update license. Please try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {license.state_abbreviation} License</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="licenseType">License Type</Label>
            <Input
              id="licenseType"
              value={licenseType}
              onChange={(e) => setLicenseType(e.target.value)}
              placeholder="e.g. APRN, RN, CDS"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="licenseNumber">License Number</Label>
            <Input
              id="licenseNumber"
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              placeholder="Enter your license number"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expirationDate">Expiration Date</Label>
            <Input
              id="expirationDate"
              type="date"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes..."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}