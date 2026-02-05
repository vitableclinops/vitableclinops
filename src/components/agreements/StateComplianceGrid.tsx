import { useState } from 'react';
import { ExternalLink, AlertCircle, Shield, Users, Settings } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useStateCompliance, StateCompliance } from '@/hooks/useStateCompliance';
import { StateProfileModal } from './StateProfileModal';

interface StateData {
  abbreviation: string;
  name: string;
  physicians: string[];
  agreements: any[];
  activeProviders: any[];
}

interface StateComplianceGridProps {
  stateData: StateData[];
}

const StateComplianceGrid = ({ stateData }: StateComplianceGridProps) => {
  const { allData: complianceData, refetch } = useStateCompliance();
  const [selectedState, setSelectedState] = useState<StateCompliance | null>(null);
  const [selectedStateInfo, setSelectedStateInfo] = useState<StateData | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const getComplianceInfo = (stateAbbr: string) => {
    return complianceData.find(c => c.state_abbreviation === stateAbbr);
  };

  const openStateProfile = (state: StateData, compliance: StateCompliance | undefined) => {
    if (compliance) {
      setSelectedState(compliance);
      setSelectedStateInfo(state);
      setModalOpen(true);
    }
  };

  const handleModalClose = (open: boolean) => {
    setModalOpen(open);
    if (!open) {
      setSelectedState(null);
      setSelectedStateInfo(null);
    }
  };

  const handleUpdate = () => {
    refetch();
  };

  return (
    <>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {stateData.map((state) => {
          const compliance = getComplianceInfo(state.abbreviation);
          const hasComplianceRisk = state.agreements.some(
            a => a.workflow_status === 'active' && !a.medallion_document_url && !a.agreement_document_url
          );

          return (
            <Card 
              key={state.abbreviation} 
              className="card-interactive flex flex-col cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => openStateProfile(state, compliance)}
            >
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center">
                      <span className="text-xl font-bold text-primary">
                        {state.abbreviation}
                      </span>
                    </div>
                    <div>
                      <CardTitle className="text-lg">{state.name}</CardTitle>
                      <CardDescription>
                        {state.physicians.length} physician{state.physicians.length !== 1 ? 's' : ''}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasComplianceRisk && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Risk
                      </Badge>
                    )}
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        openStateProfile(state, compliance);
                      }}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4 flex-1">
                {/* Provider count */}
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <span className="font-medium">Active Providers</span>
                  </div>
                  <span className="text-2xl font-bold text-success">
                    {state.activeProviders.length}
                  </span>
                </div>

                {/* Compliance Requirements Section */}
                {compliance && (
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-sm font-semibold text-foreground">Compliance Requirements</p>

                    {/* Meeting Cadence */}
                    {compliance.ca_meeting_cadence && compliance.ca_meeting_cadence !== 'NA' && (
                      <div className="text-sm">
                        <p className="font-medium text-muted-foreground">Meeting Cadence</p>
                        <p className="text-foreground">{compliance.ca_meeting_cadence}</p>
                      </div>
                    )}

                    {/* Requirements Badges */}
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={compliance.ca_required ? 'default' : 'secondary'}>
                        CA {compliance.ca_required ? 'Required' : 'Not Req.'}
                      </Badge>
                      {typeof compliance.rxr_required === 'boolean' && (
                        <Badge variant={compliance.rxr_required ? 'default' : 'secondary'}>
                          RxA {compliance.rxr_required ? 'Req.' : 'Not Req.'}
                        </Badge>
                      )}
                      {compliance.nlc && (
                        <Badge variant="outline">NLC</Badge>
                      )}
                    </div>

                    {/* FPA Status */}
                    {compliance.fpa_status && compliance.fpa_status !== 'NA' && (
                      <div className="text-sm">
                        <p className="font-medium text-muted-foreground">Practice Authority</p>
                        <p className="text-foreground text-xs">{compliance.fpa_status}</p>
                      </div>
                    )}

                    {/* Knowledge Base Link */}
                    {compliance.knowledge_base_url && (
                      <a
                        href={compliance.knowledge_base_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View Requirements
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                )}

                {/* Supervising physicians */}
                <div className="border-t pt-4">
                  <p className="text-sm font-medium text-muted-foreground mb-2">
                    Supervising Physicians
                  </p>
                  <div className="space-y-2">
                    {state.physicians.map((physician) => {
                      const agreement = state.agreements.find(a => a.physician_name === physician);
                      const providerCount = state.activeProviders.filter(
                        p => p.agreement_id === agreement?.id
                      ).length;

                      return (
                        <div
                          key={physician}
                          className="flex items-center justify-between p-3 rounded-lg border"
                        >
                          <div className="flex items-center gap-2">
                            <Shield className="h-4 w-4 text-primary" />
                            <span className="text-sm font-medium">Dr. {physician}</span>
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {providerCount} provider{providerCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Provider names preview */}
                {state.activeProviders.length > 0 && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground">
                      {state.activeProviders.slice(0, 3).map(p => p.provider_name).join(', ')}
                      {state.activeProviders.length > 3 && ` +${state.activeProviders.length - 3} more`}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <StateProfileModal
        open={modalOpen}
        onOpenChange={handleModalClose}
        stateData={selectedState}
        onUpdate={handleUpdate}
        physicians={selectedStateInfo?.physicians}
        providerCount={selectedStateInfo?.activeProviders.length}
        agreementCount={selectedStateInfo?.agreements.length}
      />
    </>
  );
};

export { StateComplianceGrid };
