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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { allUSStatesSorted } from '@/data/allStates';
import { PROVIDER_TYPE_CONFIG, type ProviderType } from '@/types';
import type { ReportedLicense } from './OnboardingWizard';

interface LicenseReportingStepProps {
  selectedStates: string[];
  reportedLicenses: ReportedLicense[];
  onUpdate: (licenses: ReportedLicense[]) => void;
  providerType?: ProviderType | null;
}

const DEFAULT_LICENSE_TYPES = ['RN', 'APRN', 'Prescriptive Authority', 'DEA', 'State Controlled Substance'];

export function LicenseReportingStep({ selectedStates, reportedLicenses, onUpdate, providerType }: LicenseReportingStepProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLicense, setEditingLicense] = useState<ReportedLicense | null>(null);
  const [formData, setFormData] = useState<Partial<ReportedLicense>>({
    state: '',
    licenseType: '',
    licenseNumber: '',
    expirationDate: '',
    evidenceUploaded: false,
    notes: '',
  });

  // Get license types based on provider type
  const availableLicenseTypes = providerType 
    ? PROVIDER_TYPE_CONFIG[providerType].licenseTypes 
    : DEFAULT_LICENSE_TYPES;

  const resetForm = () => {
    setFormData({
      state: '',
      licenseType: '',
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
      licenseType: formData.licenseType || '',
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

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          This step is optional. You can skip it and add licenses later, or Clinical Operations will create licensure tasks for states where you need new licenses.
        </AlertDescription>
      </Alert>

      {/* Licenses by state */}
      <div className="space-y-4">
        {selectedStates.map(stateAbbr => {
          const state = allUSStatesSorted.find(s => s.abbreviation === stateAbbr);
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
                <SelectContent className="max-h-[200px]">
                  {selectedStates.map(stateAbbr => {
                    const state = allUSStatesSorted.find(s => s.abbreviation === stateAbbr);
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
                onValueChange={(value) => setFormData(prev => ({ ...prev, licenseType: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select license type" />
                </SelectTrigger>
                <SelectContent>
                  {availableLicenseTypes.map(type => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
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
