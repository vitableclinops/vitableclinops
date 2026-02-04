import { useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { states } from '@/data/mockData';
import { 
  Search,
  MapPin,
  Shield,
  Users,
  DollarSign,
  Clock,
  ChevronRight,
  Edit,
  Plus
} from 'lucide-react';
import { cn } from '@/lib/utils';

const StateConfigPage = () => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredStates = states.filter(state =>
    state.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    state.abbreviation.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar 
        userRole="admin"
        userName="Sarah Chen"
        userEmail="sarah.chen@example.com"
      />
      
      <main className="pl-64 transition-all duration-300">
        <div className="p-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                State Configuration
              </h1>
              <p className="text-muted-foreground mt-1">
                Manage state-specific licensure requirements and instructions.
              </p>
            </div>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add State
            </Button>
          </div>

          {/* Search */}
          <div className="relative max-w-md mb-6">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search states..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* States grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredStates.map(state => (
              <Card key={state.id} className="card-interactive cursor-pointer group">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'flex h-12 w-12 items-center justify-center rounded-lg text-lg font-bold',
                        state.hasFPA ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'
                      )}>
                        {state.abbreviation}
                      </div>
                      <div>
                        <CardTitle className="text-lg">{state.name}</CardTitle>
                        <div className="flex items-center gap-2 mt-1">
                          {state.hasFPA ? (
                            <Badge variant="secondary" className="text-xs bg-success/10 text-success">
                              <Shield className="h-3 w-3 mr-1" />
                              FPA
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              <Users className="h-3 w-3 mr-1" />
                              Collaboration
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <DollarSign className="h-4 w-4" />
                      <span>${state.applicationFeeRange.min} - ${state.applicationFeeRange.max}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span>{state.processingTimeWeeks.min}-{state.processingTimeWeeks.max} weeks</span>
                    </div>
                  </div>

                  {/* Notes preview */}
                  {state.notes && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {state.notes}
                    </p>
                  )}

                  {/* Requirements */}
                  <div className="flex items-center gap-2 pt-2 border-t">
                    {state.requiresCollaborativeAgreement && (
                      <Badge variant="outline" className="text-xs">
                        Collaborative Agreement
                      </Badge>
                    )}
                    {state.hasFPA && (
                      <Badge variant="outline" className="text-xs text-success border-success/30">
                        Full Practice Authority
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredStates.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <MapPin className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No states found matching "{searchQuery}"</p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
};

export default StateConfigPage;
