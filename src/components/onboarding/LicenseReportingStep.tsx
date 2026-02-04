import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FileCheck, Plus, Trash2, FileText, AlertCircle } from 'lucide-react';
import { states } from '@/data/mockData';
import type { ReportedLicense } from './OnboardingWizard';

interface LicenseReportingStepProps {
  selectedStates: string[];
  reportedLicenses: ReportedLicense[];
  onUpdate: (licenses: ReportedLicense[]) => void;
}

const LICENSE_TYPES = [
  { value: 'RN', label: 'RN License' },
  { value: 'APRN', label: 'APRN License' },
  { value: 'Prescriptive Authority', label: 'Prescriptive Authority / Furnishing' },
  { value: 'DEA', label: 'DEA Registration' },
  { value: 'State Controlled Substance', label: 'State Controlled Substance License' },
] as const;

export function LicenseReportingStep({ selectedStates, reportedLicenses, onUpdate }: LicenseReportingStepProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLicense, setEditingLicense] = useState<ReportedLicense | null>(null);
  const [formData, setFormData] = useState<Partial<ReportedLicense>>({
    state: '',
    licenseType: 'APRN',
    licenseNumber: '',
    expirationDate: '',
    evidenceUploaded: false,
    notes: '',
  });

  const resetForm = () => {
    setFormData({
      state: '',
      licenseType: 'APRN',
      licenseNumber: '',
      expirationDate: '',
      evidenceUploaded: false,
      notes: '',
    });
    setEditingLicense(null);
  };

  const handleOpenDialog = (license?: ReportedLicense) => {
    if (license) {
      setEditingLicense(license);
      setFormData(license);
    } else {
      resetForm();
    }
    setIsDialogOpen(true);
  };

  const handleSaveLicense = () => {
    if (!formData.state || !formData.licenseType) return;

    const newLicense: ReportedLicense = {
      id: editingLicense?.id || `${formData.state}-${formData.licenseType}-${Date.now()}`,
      state: formData.state!,
      licenseType: formData.licenseType as ReportedLicense['licenseType'],
      licenseNumber: formData.licenseNumber || '',
      expirationDate: formData.expirationDate || '',
      evidenceUploaded: formData.evidenceUploaded || false,
      notes: formData.notes || '',
    };

    if (editingLicense) {
      onUpdate(reportedLicenses.map(l => l.id === editingLicense.id ? newLicense : l));
    } else {
      onUpdate([...reportedLicenses, newLicense]);
    }

    setIsDialogOpen(false);
    resetForm();
  };

  const handleDeleteLicense = (id: string) => {
    onUpdate(reportedLicenses.filter(l => l.id !== id));
  };

  const getLicensesByState = () => {
    const grouped: Record<string, ReportedLicense[]> = {};
    selectedStates.forEach(stateAbbr => {
      grouped[stateAbbr] = reportedLicenses.filter(l => l.state === stateAbbr);
    });
    return grouped;
  };

  const licensesByState = getLicensesByState();

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
          <FileCheck className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">Report Existing Licenses</h2>
        <p className="text-muted-foreground mt-2">
          Tell us about licenses you already hold. This speeds up your activation.
        </p>
      </div>

      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-medium">Self-Reported Licenses</p>
            <p className="mt-1">
              Licenses you report here will be verified by Clinical Operations. 
              You can upload supporting documentation or add it later.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Licenses by state */}
      <div className="space-y-4">
        {selectedStates.map(stateAbbr => {
          const state = states.find(s => s.abbreviation === stateAbbr);
          const licenses = licensesByState[stateAbbr] || [];

          return (
            <Card key={stateAbbr}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">{state?.name || stateAbbr}</CardTitle>
                    <CardDescription>
                      {licenses.length === 0 
                        ? 'No licenses reported yet' 
                        : `${licenses.length} license${licenses.length > 1 ? 's' : ''} reported`}
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setFormData(prev => ({ ...prev, state: stateAbbr }));
                      handleOpenDialog();
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add License
                  </Button>
                </div>
              </CardHeader>
              {licenses.length > 0 && (
                <CardContent className="pt-0">
                  <div className="space-y-2">
                    {licenses.map(license => (
                      <div
                        key={license.id}
                        className="flex items-center justify-between p-3 bg-muted rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <p className="font-medium text-sm">{license.licenseType}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {license.licenseNumber && (
                                <span>#{license.licenseNumber}</span>
                              )}
                              {license.expirationDate && (
                                <span>Exp: {license.expirationDate}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={license.evidenceUploaded ? 'default' : 'secondary'}>
                            {license.evidenceUploaded ? 'Evidence Uploaded' : 'Pending Upload'}
                          </Badge>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => handleOpenDialog(license)}
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteLicense(license.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {selectedStates.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <FileCheck className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>Go back and select states first</p>
        </div>
      )}

      {/* Add/Edit License Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingLicense ? 'Edit License' : 'Add License'}
            </DialogTitle>
            <DialogDescription>
              Enter your license details. You can upload evidence later.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>State</Label>
              <Select
                value={formData.state}
                onValueChange={(value) => setFormData(prev => ({ ...prev, state: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  {selectedStates.map(stateAbbr => {
                    const state = states.find(s => s.abbreviation === stateAbbr);
                    return (
                      <SelectItem key={stateAbbr} value={stateAbbr}>
                        {state?.name || stateAbbr}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>License Type</Label>
              <Select
                value={formData.licenseType}
                onValueChange={(value) => setFormData(prev => ({ ...prev, licenseType: value as ReportedLicense['licenseType'] }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select license type" />
                </SelectTrigger>
                <SelectContent>
                  {LICENSE_TYPES.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="licenseNumber">License Number</Label>
              <Input
                id="licenseNumber"
                placeholder="e.g., APRN-12345"
                value={formData.licenseNumber}
                onChange={(e) => setFormData(prev => ({ ...prev, licenseNumber: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expirationDate">Expiration Date</Label>
              <Input
                id="expirationDate"
                type="date"
                value={formData.expirationDate}
                onChange={(e) => setFormData(prev => ({ ...prev, expirationDate: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                placeholder="Any additional details..."
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveLicense} disabled={!formData.state || !formData.licenseType}>
              {editingLicense ? 'Save Changes' : 'Add License'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
