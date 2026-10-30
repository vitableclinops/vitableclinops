import { useEffect, useState } from 'react';
import { ExternalLink, Edit2, Save, X, FileText, Users, Shield, Calendar, CheckCircle, AlertCircle, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { StateCompliance } from '@/hooks/useStateCompliance';
import { stripDrPrefix } from '@/lib/directShiftsPhysicians';

interface StateProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stateData: StateCompliance | null;
  onUpdate?: () => void;
  // Optional: pass in agreement/provider data for context
  physicians?: string[];
  providerCount?: number;
  agreementCount?: number;
  agreements?: AgreementRow[];
  providers?: ProviderRow[];
}

interface AgreementRow {
  id: string;
  provider_name?: string | null;
  provider_email?: string | null;
  physician_name?: string | null;
  workflow_status?: string | null;
  agreement_document_url?: string | null;
  medallion_document_url?: string | null;
  terminated_at?: string | null;
  state_abbreviation?: string | null;
}

interface ProviderRow {
  provider_name?: string | null;
  is_active?: boolean | null;
  agreement_id?: string | null;
}

const ACTIVE_EXCLUDED_STATUSES = ['cancelled', 'terminated', 'termination_initiated', 'invalid'];

export const StateProfileModal = ({
  open,
  onOpenChange,

  stateData,
  onUpdate,
  physicians = [],
  providerCount = 0,
  agreementCount = 0,
  agreements = [],
  providers = [],
}: StateProfileModalProps) => {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedStat, setExpandedStat] = useState<'agreements' | 'providers' | 'physicians' | null>(null);

  // Start each state's popup closed rather than inheriting the last one's open dropdown
  useEffect(() => {
    if (open) setExpandedStat(null);
  }, [open]);

  // Only active, non-terminated/cancelled agreements count as active
  const activeAgreements = agreements.filter(
    (a) => !ACTIVE_EXCLUDED_STATUSES.includes(a.workflow_status || '') && !a.terminated_at
  );
  // Providers come only from active agreements, deduped by email (or name when no email)
  const providerGroups = (() => {
    const map = new Map<string, { name: string; agreements: AgreementRow[] }>();
    activeAgreements.forEach((a) => {
      const key = (a.provider_email || a.provider_name || '').trim().toLowerCase();
      if (!key) return;
      const name = a.provider_name || a.provider_email || 'Unassigned';
      const entry = map.get(key);
      if (entry) {
        entry.agreements.push(a);
      } else {
        map.set(key, { name, agreements: [a] });
      }
    });
    return Array.from(map.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g): [string, AgreementRow[]] => [g.name, g.agreements]);
  })();

  const physicianGroups = (() => {
    const map = new Map<string, { agreements: AgreementRow[]; providerNames: Set<string> }>();
    activeAgreements.forEach((a) => {
      const name = a.physician_name || 'Unassigned';
      const entry = map.get(name) || { agreements: [], providerNames: new Set<string>() };
      entry.agreements.push(a);
      if (a.provider_name) entry.providerNames.add(a.provider_name);
      map.set(name, entry);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  })();

  const statCounts = {
    agreements: agreements.length > 0 ? activeAgreements.length : agreementCount,
    providers: agreements.length > 0 ? providerGroups.length : providerCount,
    physicians: agreements.length > 0 ? physicianGroups.length : physicians.length,
  };

  const toggleStat = (stat: 'agreements' | 'providers' | 'physicians') => {
    setExpandedStat((prev) => (prev === stat ? null : stat));
  };
  
  // Form state
  const [formData, setFormData] = useState<Partial<StateCompliance>>({});

  // Initialize form when stateData changes or edit mode starts
  const startEditing = () => {
    if (stateData) {
      setFormData({
        ca_meeting_cadence: stateData.ca_meeting_cadence,
        ca_required: stateData.ca_required,
        rxr_required: stateData.rxr_required,
        nlc: stateData.nlc,
        np_md_ratio: stateData.np_md_ratio,
        fpa_status: stateData.fpa_status,
        knowledge_base_url: stateData.knowledge_base_url,
        steps_to_confirm_eligibility: stateData.steps_to_confirm_eligibility,
        licenses: stateData.licenses,
      });
    }
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setFormData({});
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!stateData) return;
    
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('state_compliance_requirements')
        .update({
          ca_meeting_cadence: formData.ca_meeting_cadence,
          ca_required: formData.ca_required,
          rxr_required: formData.rxr_required,
          nlc: formData.nlc,
          np_md_ratio: formData.np_md_ratio,
          fpa_status: formData.fpa_status,
          knowledge_base_url: formData.knowledge_base_url,
          steps_to_confirm_eligibility: formData.steps_to_confirm_eligibility,
          licenses: formData.licenses,
          updated_at: new Date().toISOString(),
        })
        .eq('id', stateData.id);

      if (error) throw error;

      toast({
        title: 'State profile updated',
        description: `${stateData.state_name} compliance requirements have been saved.`,
      });

      setIsEditing(false);
      onUpdate?.();
    } catch (err) {
      console.error('Error updating state profile:', err);
      toast({
        title: 'Update failed',
        description: 'Could not save changes. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!stateData) return null;

  const currentData = isEditing ? formData : stateData;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-xl bg-primary/10 flex items-center justify-center">
                <span className="text-2xl font-bold text-primary">
                  {stateData.state_abbreviation}
                </span>
              </div>
              <div>
                <DialogTitle className="text-xl">{stateData.state_name}</DialogTitle>
                <DialogDescription>State Compliance Profile</DialogDescription>
              </div>
            </div>
            {!isEditing ? (
              <Button variant="outline" size="sm" onClick={startEditing}>
                <Edit2 className="h-4 w-4 mr-2" />
                Edit
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={cancelEditing} disabled={isSaving}>
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={isSaving}>
                  <Save className="h-4 w-4 mr-2" />
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            )}
          </div>
        </DialogHeader>

        <Tabs defaultValue="requirements" className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="requirements">Requirements</TabsTrigger>
            <TabsTrigger value="eligibility">Eligibility</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="requirements" className="space-y-6 mt-4">
            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-4">
              <button
                type="button"
                className="p-4 rounded-lg bg-muted/50 text-center hover:bg-muted/80 transition-colors cursor-pointer"
                onClick={() => toggleStat('agreements')}
              >
                <p className="text-2xl font-bold text-primary">{statCounts.agreements}</p>
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  Active Agreements
                  <ChevronDown className={`h-3 w-3 transition-transform ${expandedStat === 'agreements' ? 'rotate-180' : ''}`} />
                </p>
              </button>
              <button
                type="button"
                className="p-4 rounded-lg bg-muted/50 text-center hover:bg-muted/80 transition-colors cursor-pointer"
                onClick={() => toggleStat('providers')}
              >
                <p className="text-2xl font-bold text-success">{statCounts.providers}</p>
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  Providers
                  <ChevronDown className={`h-3 w-3 transition-transform ${expandedStat === 'providers' ? 'rotate-180' : ''}`} />
                </p>
              </button>
              <button
                type="button"
                className="p-4 rounded-lg bg-muted/50 text-center hover:bg-muted/80 transition-colors cursor-pointer"
                onClick={() => toggleStat('physicians')}
              >
                <p className="text-2xl font-bold">{statCounts.physicians}</p>
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  Physicians
                  <ChevronDown className={`h-3 w-3 transition-transform ${expandedStat === 'physicians' ? 'rotate-180' : ''}`} />
                </p>
              </button>
            </div>

            {expandedStat === 'agreements' && (
              <div className="rounded-lg border divide-y max-h-64 overflow-y-auto">
                {statCounts.agreements === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">No active agreements in this state</p>
                )}
                {activeAgreements.map((a) => {
                  const hasDoc = Boolean(a.agreement_document_url || a.medallion_document_url) || isDocumentExemptPhysician(a.physician_name);
                  return (
                    <Link
                      key={a.id}
                      to={`/admin/agreements/${a.id}`}
                      className="flex items-center justify-between gap-2 p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{a.provider_name || a.provider_email || 'Unassigned'}</p>
                        <p className="text-xs text-muted-foreground">
                          with Dr. {stripDrPrefix(a.physician_name || 'Unassigned')}{a.state_abbreviation ? ` (${a.state_abbreviation})` : ''}
                        </p>
                      </div>
                      <div className="shrink-0">
                        {hasDoc ? (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <FileText className="h-3 w-3" />
                            Doc on file
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1 text-[10px]">
                            <AlertCircle className="h-3 w-3" />
                            Missing doc
                          </Badge>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {expandedStat === 'providers' && (
              <div className="rounded-lg border divide-y max-h-64 overflow-y-auto">
                {statCounts.providers === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">No active providers in this state</p>
                )}
                {providerGroups.map(([name, ags]) => (
                  <div key={name} className="flex items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {ags.map((a) => `Dr. ${stripDrPrefix(a.physician_name || 'Unassigned')}${a.state_abbreviation ? ` (${a.state_abbreviation})` : ''}`).join(', ')}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {ags.length} agreement{ags.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            {expandedStat === 'physicians' && (
              <div className="rounded-lg border divide-y max-h-64 overflow-y-auto">
                {statCounts.physicians === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">No supervising physicians in this state</p>
                )}
                {physicianGroups.map(([name, group]) => (
                  <div key={name} className="flex items-center justify-between gap-2 p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-xs font-medium text-primary">
                          {name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">Dr. {stripDrPrefix(name)}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {group.providerNames.size > 0
                            ? `Supervising ${Array.from(group.providerNames).join(', ')}`
                            : 'No providers assigned'}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {group.agreements.length} agreement{group.agreements.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            <Separator />

            {/* Collaborative Agreement Requirements */}
            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Collaborative Agreement
              </h3>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* CA Required Toggle */}
                <div className="space-y-2">
                  <Label htmlFor="ca_required">CA Required</Label>
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Switch
                        id="ca_required"
                        checked={formData.ca_required ?? false}
                        onCheckedChange={(checked) =>
                          setFormData({ ...formData, ca_required: checked })
                        }
                      />
                      <span className="text-sm text-muted-foreground">
                        {formData.ca_required ? 'Required' : 'Not Required'}
                      </span>
                    </div>
                  ) : (
                    <Badge variant={stateData.ca_required ? 'default' : 'secondary'}>
                      {stateData.ca_required ? 'Required' : 'Not Required'}
                    </Badge>
                  )}
                </div>

                {/* RxA Required Toggle */}
                <div className="space-y-2">
                  <Label htmlFor="rxr_required">Prescriptive Authority (RxA)</Label>
                  {isEditing ? (
                    <Input
                      id="rxr_required"
                      value={formData.rxr_required || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, rxr_required: e.target.value || null })
                      }
                      placeholder="e.g. Separate License, In Nursys, etc."
                    />
                  ) : (
                    <Badge variant={stateData.rxr_required ? 'default' : 'secondary'}>
                      {stateData.rxr_required || 'N/A'}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Meeting Cadence */}
              <div className="space-y-2">
                <Label htmlFor="ca_meeting_cadence">Meeting Cadence</Label>
                {isEditing ? (
                  <Input
                    id="ca_meeting_cadence"
                    value={formData.ca_meeting_cadence || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, ca_meeting_cadence: e.target.value })
                    }
                    placeholder="e.g., Quarterly, then annually"
                  />
                ) : (
                  <p className="text-sm p-2 rounded bg-muted/50">
                    {stateData.ca_meeting_cadence || 'Not specified'}
                  </p>
                )}
              </div>

              {/* NP:MD Ratio */}
              <div className="space-y-2">
                <Label htmlFor="np_md_ratio">NP:MD Ratio</Label>
                {isEditing ? (
                  <Input
                    id="np_md_ratio"
                    value={formData.np_md_ratio || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, np_md_ratio: e.target.value })
                    }
                    placeholder="e.g., 4, None, NA"
                  />
                ) : (
                  <p className="text-sm p-2 rounded bg-muted/50">
                    {stateData.np_md_ratio || 'Not specified'}
                  </p>
                )}
              </div>
            </div>

            <Separator />

            {/* Practice Authority */}
            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Practice Authority
              </h3>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* FPA Status */}
                <div className="space-y-2">
                  <Label htmlFor="fpa_status">FPA Status</Label>
                  {isEditing ? (
                    <Input
                      id="fpa_status"
                      value={formData.fpa_status || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, fpa_status: e.target.value })
                      }
                      placeholder="e.g., Full, Limited, Restricted"
                    />
                  ) : (
                    <p className="text-sm p-2 rounded bg-muted/50">
                      {stateData.fpa_status || 'Not specified'}
                    </p>
                  )}
                </div>

                {/* NLC */}
                <div className="space-y-2">
                  <Label htmlFor="nlc">Nurse Licensure Compact</Label>
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Switch
                        id="nlc"
                        checked={formData.nlc ?? false}
                        onCheckedChange={(checked) =>
                          setFormData({ ...formData, nlc: checked })
                        }
                      />
                      <span className="text-sm text-muted-foreground">
                        {formData.nlc ? 'Member' : 'Not a Member'}
                      </span>
                    </div>
                  ) : (
                    <Badge variant={stateData.nlc ? 'default' : 'secondary'}>
                      {stateData.nlc ? 'NLC Member' : 'Not NLC'}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <Separator />

            {/* Knowledge Base */}
            <div className="space-y-2">
              <Label htmlFor="knowledge_base_url">Knowledge Base URL</Label>
              {isEditing ? (
                <Input
                  id="knowledge_base_url"
                  type="url"
                  value={formData.knowledge_base_url || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, knowledge_base_url: e.target.value })
                  }
                  placeholder="https://..."
                />
              ) : stateData.knowledge_base_url ? (
                <a
                  href={stateData.knowledge_base_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  View State Requirements
                  <ExternalLink className="h-4 w-4" />
                </a>
              ) : (
                <p className="text-sm text-muted-foreground">No link configured</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="eligibility" className="space-y-6 mt-4">
            {/* Eligibility Steps */}
            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Steps to Confirm Eligibility
              </h3>

              {isEditing ? (
                <Textarea
                  id="steps_to_confirm_eligibility"
                  value={formData.steps_to_confirm_eligibility || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, steps_to_confirm_eligibility: e.target.value })
                  }
                  placeholder="Enter the steps required to confirm provider eligibility in this state..."
                  rows={6}
                />
              ) : (
                <div className="p-4 rounded-lg bg-muted/50">
                  {stateData.steps_to_confirm_eligibility ? (
                    <div className="space-y-2">
                      {stateData.steps_to_confirm_eligibility.split('\n').map((step, i) => (
                        <p key={i} className="text-sm">
                          {step}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No eligibility steps configured
                    </p>
                  )}
                </div>
              )}
            </div>

            <Separator />

            {/* Licenses Info */}
            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4" />
                License Information
              </h3>

              {isEditing ? (
                <Textarea
                  id="licenses"
                  value={formData.licenses || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, licenses: e.target.value })
                  }
                  placeholder="Enter license requirements or notes..."
                  rows={4}
                />
              ) : (
                <div className="p-4 rounded-lg bg-muted/50">
                  {stateData.licenses ? (
                    <p className="text-sm whitespace-pre-wrap">{stateData.licenses}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No license information configured
                    </p>
                  )}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="activity" className="space-y-6 mt-4">
            {/* Physicians */}
            {physicians.length > 0 && (
              <div className="space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Supervising Physicians ({physicians.length})
                </h3>
                <div className="space-y-2">
                  {physicians.map((physician) => (
                    <div
                      key={physician}
                      className="flex items-center gap-3 p-3 rounded-lg border"
                    >
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-xs font-medium text-primary">
                          {physician.split(' ').map(n => n[0]).join('')}
                        </span>
                      </div>
                      <span className="text-sm font-medium">Dr. {stripDrPrefix(physician)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {physicians.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No active agreements in this state</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
