import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProviderClassificationBadge } from '@/components/ProviderClassificationBadge';

export interface ProviderTableData {
  id: string;
  full_name: string | null;
  preferred_name: string | null;
  email: string;
  phone_number: string | null;
  npi_number: string | null;
  credentials: string | null;
  profession: string | null;
  avatar_url: string | null;
  employment_status: string | null;
  employment_type: string | null;
  agency_name: string | null;
  actively_licensed_states: string | null;
  primary_specialty: string | null;
  address_state: string | null;
  has_collaborative_agreements: boolean | null;
  activation_status: string | null;
  collaborative_physician: string | null;
  renewal_handling: string | null;
  languages: string | null;
  pod_name: string | null;
  pod_lead_id: string | null;
  pod_lead_name: string | null;
}

interface ProviderTableProps {
  providers: ProviderTableData[];
  onRowClick?: (provider: ProviderTableData) => void;
  isAdmin: boolean;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  onSort: (column: string) => void;
}

const getInitials = (name: string | null) => {
  if (!name) return '?';
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

const getStatusBadge = (status: string | null) => {
  switch (status) {
    case 'active':
      return <Badge className="bg-success/10 text-success border-success/20">Active</Badge>;
    case 'inactive':
      return <Badge variant="secondary">Inactive</Badge>;
    case 'termed':
      return <Badge variant="destructive">Terminated</Badge>;
    default:
      return <Badge variant="outline">Unknown</Badge>;
  }
};

const getActivationBadge = (status: string | null) => {
  switch (status) {
    case 'ready':
      return <Badge className="bg-success/10 text-success border-success/20 text-[10px]">Ready</Badge>;
    case 'pending_onboarding':
      return <Badge variant="secondary" className="text-[10px]">Onboarding</Badge>;
    case 'pending_activation':
      return <Badge className="bg-warning/10 text-warning border-warning/20 text-[10px]">Pending</Badge>;
    case 'Terminated':
      return <Badge variant="destructive" className="text-[10px]">Termed</Badge>;
    default:
      return status ? <Badge variant="outline" className="text-[10px]">{status}</Badge> : null;
  }
};

const getRenewalBadge = (handling: string | null) => {
  switch (handling) {
    case 'self':
      return <Badge variant="outline" className="text-[10px]">Self</Badge>;
    case 'medallion':
      return <Badge variant="secondary" className="text-[10px]">Medallion</Badge>;
    case 'internal':
      return <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">Internal</Badge>;
    default:
      return null;
  }
};

const SortHeader = ({ 
  column, 
  label, 
  currentSort, 
  direction, 
  onSort 
}: { 
  column: string; 
  label: string; 
  currentSort: string; 
  direction: 'asc' | 'desc'; 
  onSort: (col: string) => void;
}) => (
  <TableHead 
    className="cursor-pointer hover:bg-muted/50 select-none"
    onClick={() => onSort(column)}
  >
    <div className="flex items-center gap-1">
      {label}
      {currentSort === column && (
        direction === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
      )}
    </div>
  </TableHead>
);

export const ProviderTable = ({ 
  providers, 
  onRowClick, 
  isAdmin,
  sortColumn,
  sortDirection,
  onSort,
}: ProviderTableProps) => {
  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <SortHeader column="full_name" label="Provider" currentSort={sortColumn} direction={sortDirection} onSort={onSort} />
            <SortHeader column="profession" label="Type" currentSort={sortColumn} direction={sortDirection} onSort={onSort} />
            <TableHead>NPI</TableHead>
            <SortHeader column="employment_type" label="Employment" currentSort={sortColumn} direction={sortDirection} onSort={onSort} />
            <SortHeader column="actively_licensed_states" label="Licensed States" currentSort={sortColumn} direction={sortDirection} onSort={onSort} />
            <TableHead>Home State</TableHead>
            {isAdmin && <SortHeader column="activation_status" label="Activation" currentSort={sortColumn} direction={sortDirection} onSort={onSort} />}
            {isAdmin && <SortHeader column="employment_status" label="Status" currentSort={sortColumn} direction={sortDirection} onSort={onSort} />}
            {isAdmin && <TableHead>Collaboration</TableHead>}
            {isAdmin && <TableHead>Renewals</TableHead>}
            {isAdmin && <TableHead>Pod Lead</TableHead>}
            {isAdmin && <TableHead>Email</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {providers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={isAdmin ? 12 : 6} className="text-center py-8 text-muted-foreground">
                No providers found matching your filters
              </TableCell>
            </TableRow>
          ) : (
            providers.map(provider => (
              <TableRow 
                key={provider.id}
                className={cn(
                  isAdmin && 'cursor-pointer hover:bg-muted/50 transition-colors'
                )}
                onClick={() => onRowClick?.(provider)}
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={provider.avatar_url || undefined} />
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {getInitials(provider.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <span className="font-medium">
                        {provider.preferred_name || provider.full_name || 'Unknown'}
                      </span>
                      {provider.primary_specialty && (
                        <p className="text-xs text-muted-foreground">{provider.primary_specialty}</p>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{provider.profession || provider.credentials || '-'}</Badge>
                </TableCell>
                <TableCell className="font-mono text-sm">{provider.npi_number || '-'}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <ProviderClassificationBadge employmentType={provider.employment_type} compact />
                    {provider.employment_type === 'agency' && provider.agency_name && (
                      <span className="text-xs text-muted-foreground truncate max-w-[140px]">{provider.agency_name}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm max-w-[200px] truncate block">
                    {provider.actively_licensed_states || '-'}
                  </span>
                </TableCell>
                <TableCell>{provider.address_state || '-'}</TableCell>
                {isAdmin && <TableCell>{getActivationBadge(provider.activation_status)}</TableCell>}
                {isAdmin && <TableCell>{getStatusBadge(provider.employment_status)}</TableCell>}
                {isAdmin && (
                  <TableCell>
                    {(() => {
                      const isMD = provider.profession === 'MD' || provider.credentials === 'MD';
                      if (isMD) {
                        return provider.has_collaborative_agreements ? (
                          <Badge variant="secondary" className="bg-purple-500/10 text-purple-600 border-purple-200">Collaborating Physician</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">Not supervising</span>
                        );
                      }
                      if (provider.collaborative_physician) {
                        return (
                          <div className="flex flex-col gap-0.5">
                            {provider.has_collaborative_agreements && (
                              <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-200 text-[10px]">Has Collabs</Badge>
                            )}
                            <span className="text-xs text-muted-foreground truncate max-w-[120px]">{provider.collaborative_physician}</span>
                          </div>
                        );
                      }
                      return provider.has_collaborative_agreements ? (
                        <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-200">Has Collabs</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">No</span>
                      );
                    })()}
                  </TableCell>
                )}
                {isAdmin && <TableCell>{getRenewalBadge(provider.renewal_handling)}</TableCell>}
                {isAdmin && (
                  <TableCell className="text-sm">
                    {provider.pod_lead_name || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                )}
                {isAdmin && (
                  <TableCell className="text-muted-foreground text-sm">{provider.email}</TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};
