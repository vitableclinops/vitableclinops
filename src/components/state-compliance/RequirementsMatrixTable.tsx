import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Search, ChevronDown, ChevronUp, CheckCircle2, XCircle, Minus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { StateCompliance } from '@/hooks/useStateCompliance';

interface RequirementsMatrixTableProps {
  data: StateCompliance[];
  loading: boolean;
}

type SortField = 'state_name' | 'ca_required' | 'rxr_required' | 'nlc' | 'fpa_status' | 'ca_meeting_cadence';
type SortDir = 'asc' | 'desc';

const BoolCell = ({ value }: { value: boolean }) => (
  value ? (
    <CheckCircle2 className="h-4 w-4 text-success mx-auto" />
  ) : (
    <XCircle className="h-4 w-4 text-muted-foreground/40 mx-auto" />
  )
);

const RequirementsMatrixTable = ({ data, loading }: RequirementsMatrixTableProps) => {
  const [search, setSearch] = useState('');
  const [caFilter, setCaFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [nlcFilter, setNlcFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [sortField, setSortField] = useState<SortField>('state_name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3 inline ml-1" /> : <ChevronDown className="h-3 w-3 inline ml-1" />;
  };

  const filtered = data
    .filter(s => {
      const matchesSearch = !search || 
        s.state_name.toLowerCase().includes(search.toLowerCase()) ||
        s.state_abbreviation.toLowerCase().includes(search.toLowerCase());
      const matchesCa = caFilter === 'all' || (caFilter === 'yes' ? s.ca_required : !s.ca_required);
      const matchesNlc = nlcFilter === 'all' || (nlcFilter === 'yes' ? s.nlc : !s.nlc);
      return matchesSearch && matchesCa && matchesNlc;
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'state_name') return a.state_name.localeCompare(b.state_name) * dir;
      if (sortField === 'ca_required') return (Number(a.ca_required) - Number(b.ca_required)) * dir;
      if (sortField === 'rxr_required') return (Number(a.rxr_required) - Number(b.rxr_required)) * dir;
      if (sortField === 'nlc') return (Number(a.nlc) - Number(b.nlc)) * dir;
      if (sortField === 'fpa_status') return (a.fpa_status || '').localeCompare(b.fpa_status || '') * dir;
      if (sortField === 'ca_meeting_cadence') return (a.ca_meeting_cadence || '').localeCompare(b.ca_meeting_cadence || '') * dir;
      return 0;
    });

  const caRequiredCount = data.filter(s => s.ca_required).length;
  const nlcCount = data.filter(s => s.nlc).length;

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading state requirements…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary badges */}
      <div className="flex flex-wrap gap-3">
        <Badge variant="outline" className="text-sm py-1 px-3">
          {data.length} states loaded
        </Badge>
        <Badge variant="secondary" className="text-sm py-1 px-3">
          {caRequiredCount} CA required
        </Badge>
        <Badge variant="secondary" className="text-sm py-1 px-3">
          {nlcCount} NLC member{nlcCount !== 1 ? 's' : ''}
        </Badge>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search states…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={caFilter} onValueChange={v => setCaFilter(v as any)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="CA Required" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All CA Status</SelectItem>
            <SelectItem value="yes">CA Required</SelectItem>
            <SelectItem value="no">No CA</SelectItem>
          </SelectContent>
        </Select>
        <Select value={nlcFilter} onValueChange={v => setNlcFilter(v as any)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="NLC" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All NLC</SelectItem>
            <SelectItem value="yes">NLC Member</SelectItem>
            <SelectItem value="no">Not NLC</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {filtered.length} of {data.length}
        </span>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50 min-w-[180px]" 
                onClick={() => toggleSort('state_name')}
              >
                State <SortIcon field="state_name" />
              </TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50 text-center w-[80px]"
                onClick={() => toggleSort('ca_required')}
              >
                CA Req. <SortIcon field="ca_required" />
              </TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50 text-center w-[80px]"
                onClick={() => toggleSort('rxr_required')}
              >
                RxA Req. <SortIcon field="rxr_required" />
              </TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50 text-center w-[60px]"
                onClick={() => toggleSort('nlc')}
              >
                NLC <SortIcon field="nlc" />
              </TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50 min-w-[140px]"
                onClick={() => toggleSort('fpa_status')}
              >
                Practice Authority <SortIcon field="fpa_status" />
              </TableHead>
              <TableHead className="min-w-[100px]">NP:MD Ratio</TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50 min-w-[180px]"
                onClick={() => toggleSort('ca_meeting_cadence')}
              >
                Meeting Cadence <SortIcon field="ca_meeting_cadence" />
              </TableHead>
              <TableHead className="w-[60px] text-center">Guide</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(state => (
              <TableRow key={state.id} className="hover:bg-muted/30">
                <TableCell>
                  <Link 
                    to={`/states/${state.state_abbreviation}`}
                    className="flex items-center gap-2 font-medium text-foreground hover:text-primary transition-colors"
                  >
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded bg-primary/10 text-xs font-bold text-primary shrink-0">
                      {state.state_abbreviation}
                    </span>
                    {state.state_name}
                  </Link>
                </TableCell>
                <TableCell className="text-center"><BoolCell value={state.ca_required} /></TableCell>
                <TableCell className="text-center"><BoolCell value={state.rxr_required} /></TableCell>
                <TableCell className="text-center"><BoolCell value={state.nlc} /></TableCell>
                <TableCell>
                  {state.fpa_status && state.fpa_status !== 'NA' ? (
                    <Badge variant="outline" className="text-xs whitespace-nowrap">
                      {state.fpa_status}
                    </Badge>
                  ) : (
                    <Minus className="h-4 w-4 text-muted-foreground/40" />
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {state.np_md_ratio && state.np_md_ratio !== 'NA' ? state.np_md_ratio : '—'}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {state.ca_meeting_cadence && state.ca_meeting_cadence !== 'NA' 
                      ? state.ca_meeting_cadence 
                      : '—'}
                  </span>
                </TableCell>
                <TableCell className="text-center">
                  {state.knowledge_base_url ? (
                    <a
                      href={state.knowledge_base_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:text-primary/80"
                      onClick={e => e.stopPropagation()}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : (
                    <Minus className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No states match your filters.
        </div>
      )}
    </div>
  );
};

export { RequirementsMatrixTable };
