import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';

interface ProviderFiltersProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  stateFilter: string;
  onStateChange: (value: string) => void;
  professionFilter: string;
  onProfessionChange: (value: string) => void;
  statusFilter: string;
  onStatusChange: (value: string) => void;
  availableStates: string[];
  availableProfessions: string[];
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}

export const ProviderFilters = ({
  searchQuery,
  onSearchChange,
  stateFilter,
  onStateChange,
  professionFilter,
  onProfessionChange,
  statusFilter,
  onStatusChange,
  availableStates,
  availableProfessions,
  onClearFilters,
  hasActiveFilters,
}: ProviderFiltersProps) => {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-6">
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, NPI, or email..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>
      
      <Select value={stateFilter} onValueChange={onStateChange}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="State" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All States</SelectItem>
          {availableStates.map(state => (
            <SelectItem key={state} value={state}>{state}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={professionFilter} onValueChange={onProfessionChange}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Profession" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Professions</SelectItem>
          {availableProfessions.map(prof => (
            <SelectItem key={prof} value={prof}>{prof}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={statusFilter} onValueChange={onStatusChange}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
          <SelectItem value="termed">Terminated</SelectItem>
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters} className="gap-1">
          <X className="h-4 w-4" />
          Clear
        </Button>
      )}
    </div>
  );
};
