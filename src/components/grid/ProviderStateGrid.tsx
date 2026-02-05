import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Search, Grid3X3, Filter, Info } from 'lucide-react';
import { StatusCell } from './StatusCell';
import { CellDetailPanel } from './CellDetailPanel';
import type { GridData, GridCell, GridViewMode, CellStatus } from '@/types/grid';

interface ProviderStateGridProps {
  data: GridData;
  className?: string;
}

const demandTagStyles: Record<string, string> = {
  critical: 'bg-destructive/10 text-destructive border-destructive/30',
  at_risk: 'bg-warning/10 text-warning border-warning/30',
  watch: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  stable: 'bg-muted text-muted-foreground border-muted',
};

export function ProviderStateGrid({ data, className }: ProviderStateGridProps) {
  const [viewMode, setViewMode] = useState<GridViewMode>('licensure');
  const [selectedCell, setSelectedCell] = useState<{ providerId: string; stateId: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<CellStatus | 'all'>('all');

  // Filter providers based on search
  const filteredProviders = useMemo(() => {
    if (!searchQuery.trim()) return data.providers;
    const query = searchQuery.toLowerCase();
    return data.providers.filter(p => 
      p.name.toLowerCase().includes(query) || 
      p.email.toLowerCase().includes(query)
    );
  }, [data.providers, searchQuery]);

  // Get cell data
  const getCell = (providerId: string, stateId: string): GridCell | undefined => {
    return data.cells.get(`${providerId}-${stateId}`);
  };

  // Get cell status based on view mode
  const getCellStatus = (cell: GridCell | undefined): CellStatus => {
    if (!cell) return 'gray';
    return viewMode === 'licensure' ? cell.licensure.status : cell.credentialing.status;
  };

  // Filter states by status if filter is active
  const shouldShowCell = (cell: GridCell | undefined): boolean => {
    if (filterStatus === 'all') return true;
    return getCellStatus(cell) === filterStatus;
  };

  // Calculate summary stats
  const stats = useMemo(() => {
    let green = 0, yellow = 0, red = 0, gray = 0;
    
    data.cells.forEach((cell) => {
      const status = getCellStatus(cell);
      if (status === 'green') green++;
      else if (status === 'yellow') yellow++;
      else if (status === 'red') red++;
      else gray++;
    });

    return { green, yellow, red, gray, total: green + yellow + red + gray };
  }, [data.cells, viewMode]);

  const selectedCellData = selectedCell 
    ? getCell(selectedCell.providerId, selectedCell.stateId) 
    : null;
  const selectedProvider = selectedCell 
    ? data.providers.find(p => p.id === selectedCell.providerId) 
    : null;
  const selectedState = selectedCell 
    ? data.states.find(s => s.id === selectedCell.stateId) 
    : null;

  return (
    <div className={cn('flex gap-4', className)}>
      {/* Main Grid */}
      <div className="flex-1 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Grid3X3 className="h-5 w-5 text-muted-foreground" />
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as GridViewMode)}>
              <TabsList>
                <TabsTrigger value="licensure">Licensure Status</TabsTrigger>
                <TabsTrigger value="credentialing">Credentialing Readiness</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search providers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 w-64"
              />
            </div>
          </div>
        </div>

        {/* Legend and Stats */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-success" />
              <span>Active ({stats.green})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-warning" />
              <span>Warning ({stats.yellow})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-destructive" />
              <span>Blocked ({stats.red})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-muted-foreground/50" />
              <span>N/A ({stats.gray})</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <div className="flex gap-1">
              {(['all', 'red', 'yellow', 'green'] as const).map((status) => (
                <Button
                  key={status}
                  variant={filterStatus === status ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterStatus(status)}
                  className="text-xs h-7 px-2"
                >
                  {status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Grid */}
        <Card>
          <CardContent className="p-0 overflow-auto">
            <div className="min-w-max">
              {/* Header Row - States */}
              <div className="flex border-b bg-muted/30 sticky top-0 z-10">
                <div className="w-48 flex-shrink-0 p-2 border-r font-medium text-sm bg-muted/50">
                  Provider
                </div>
                {data.states.map((state) => (
                  <div
                    key={state.id}
                    className="w-12 flex-shrink-0 p-1 border-r text-center"
                  >
                    <div className="font-medium text-xs">{state.abbreviation}</div>
                    {state.demandTag && (
                      <Badge 
                        variant="outline" 
                        className={cn(
                          'text-[10px] px-1 py-0 mt-0.5',
                          demandTagStyles[state.demandTag]
                        )}
                      >
                        {state.demandTag === 'critical' ? '!' : 
                         state.demandTag === 'at_risk' ? '⚠' : 
                         state.demandTag === 'watch' ? '👁' : '•'}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>

              {/* Provider Rows */}
              {filteredProviders.map((provider) => (
                <div key={provider.id} className="flex border-b hover:bg-muted/20">
                  <div className="w-48 flex-shrink-0 p-2 border-r">
                    <div className="font-medium text-sm truncate">{provider.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {provider.credentials || provider.providerType}
                    </div>
                  </div>
                  {data.states.map((state) => {
                    const cell = getCell(provider.id, state.id);
                    const status = getCellStatus(cell);
                    const isSelected = selectedCell?.providerId === provider.id && 
                                       selectedCell?.stateId === state.id;
                    
                    if (!shouldShowCell(cell)) {
                      return (
                        <div key={state.id} className="w-12 flex-shrink-0 p-1 border-r" />
                      );
                    }

                    return (
                      <div key={state.id} className="w-12 flex-shrink-0 p-1 border-r flex items-center justify-center">
                        <StatusCell
                          status={status}
                          isSelected={isSelected}
                          compact
                          onClick={() => setSelectedCell(
                            isSelected ? null : { providerId: provider.id, stateId: state.id }
                          )}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}

              {filteredProviders.length === 0 && (
                <div className="p-8 text-center text-muted-foreground">
                  No providers found matching your search.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Info Panel */}
        {viewMode === 'credentialing' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 text-sm">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="font-medium">Credentialing Readiness</p>
              <p className="text-muted-foreground">
                This view shows the most restrictive unmet requirement for each provider-state combination.
                A provider may be green in licensure but yellow or red here if agreements, authority, or compliance are incomplete.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Detail Panel */}
      {selectedCellData && selectedProvider && selectedState && (
        <div className="flex-shrink-0">
          <CellDetailPanel
            cell={selectedCellData}
            provider={selectedProvider}
            state={selectedState}
            onClose={() => setSelectedCell(null)}
          />
        </div>
      )}
    </div>
  );
}
