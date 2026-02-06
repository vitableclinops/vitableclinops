import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/hooks/useAuth';
import { 
  Search, 
  BookOpen, 
  FileText, 
  GraduationCap, 
  Shield, 
  FileCode,
  MapPin,
  Clock,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { 
  knowledgeBaseArticles, 
  getKnowledgeBaseByCategory, 
  searchKnowledgeBase,
  states,
  type KnowledgeBaseArticle 
} from '@/data/mockData';
import { format } from 'date-fns';

const categoryConfig = {
  state_guides: { 
    label: 'State Guides', 
    icon: MapPin, 
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    description: 'State-specific regulatory requirements and processes'
  },
  sop: { 
    label: 'SOPs', 
    icon: FileText, 
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
    description: 'Standard operating procedures'
  },
  training: { 
    label: 'Training', 
    icon: GraduationCap, 
    color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    description: 'Onboarding and training resources'
  },
  compliance: { 
    label: 'Compliance', 
    icon: Shield, 
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
    description: 'Compliance policies and procedures'
  },
  templates: { 
    label: 'Templates', 
    icon: FileCode, 
    color: 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-300',
    description: 'Communication templates and forms'
  },
};

function ArticleCard({ article, onClick }: { article: KnowledgeBaseArticle; onClick: () => void }) {
  const config = categoryConfig[article.category];
  const Icon = config.icon;
  const state = article.stateId ? states.find(s => s.id === article.stateId) : null;
  
  return (
    <Card 
      className="cursor-pointer hover:shadow-md transition-shadow group"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-lg ${config.color}`}>
              <Icon className="h-4 w-4" />
            </div>
            {state && (
              <Badge variant="outline">{state.abbreviation}</Badge>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <CardTitle className="text-base mt-2 leading-tight">{article.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-2">{article.summary}</p>
        <div className="flex items-center gap-2 mt-3">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            Updated {format(article.lastUpdated, 'MMM d, yyyy')}
          </span>
        </div>
        {article.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {article.tags.slice(0, 3).map(tag => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ArticleDetail({ article, onBack }: { article: KnowledgeBaseArticle; onBack: () => void }) {
  const config = categoryConfig[article.category];
  const Icon = config.icon;
  const state = article.stateId ? states.find(s => s.id === article.stateId) : null;
  
  return (
    <div className="space-y-6">
      <button 
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        ← Back to Knowledge Base
      </button>
      
      <div className="flex items-start gap-4">
        <div className={`p-3 rounded-xl ${config.color}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Badge className={config.color}>{config.label}</Badge>
            {state && <Badge variant="outline">{state.name}</Badge>}
          </div>
          <h1 className="text-2xl font-bold">{article.title}</h1>
          <p className="text-muted-foreground mt-1">{article.summary}</p>
          <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Updated {format(article.lastUpdated, 'MMMM d, yyyy')}
            </span>
            {article.sourceUrl && (
              <a 
                href={article.sourceUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                View Source
              </a>
            )}
          </div>
        </div>
      </div>
      
      <Card>
        <CardContent className="pt-6">
          <ScrollArea className="h-[calc(100vh-400px)]">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              {article.content.split('\n').map((line, i) => {
                if (line.startsWith('# ')) {
                  return <h1 key={i} className="text-xl font-bold mt-6 mb-3">{line.replace('# ', '')}</h1>;
                }
                if (line.startsWith('## ')) {
                  return <h2 key={i} className="text-lg font-semibold mt-5 mb-2">{line.replace('## ', '')}</h2>;
                }
                if (line.startsWith('### ')) {
                  return <h3 key={i} className="text-base font-semibold mt-4 mb-2">{line.replace('### ', '')}</h3>;
                }
                if (line.startsWith('- **') || line.startsWith('- ')) {
                  const boldMatch = line.match(/- \*\*([^*]+)\*\*:?\s*(.*)/);
                  if (boldMatch) {
                    return (
                      <p key={i} className="ml-4 my-1">
                        • <strong>{boldMatch[1]}</strong>{boldMatch[2] ? `: ${boldMatch[2]}` : ''}
                      </p>
                    );
                  }
                  return <p key={i} className="ml-4 my-1">• {line.replace('- ', '')}</p>;
                }
                if (line.match(/^\d+\./)) {
                  return <p key={i} className="ml-4 my-1">{line}</p>;
                }
                if (line.startsWith('|')) {
                  return null; // Skip table formatting for now
                }
                if (line.startsWith('---')) {
                  return <hr key={i} className="my-4" />;
                }
                if (line.startsWith('> ')) {
                  return (
                    <blockquote key={i} className="border-l-4 border-primary pl-4 my-3 italic text-muted-foreground">
                      {line.replace('> ', '')}
                    </blockquote>
                  );
                }
                if (line.trim() === '') {
                  return <br key={i} />;
                }
                return <p key={i} className="my-2">{line}</p>;
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
      
      <div className="flex flex-wrap gap-2">
        {article.tags.map(tag => (
          <Badge key={tag} variant="secondary">{tag}</Badge>
        ))}
      </div>
    </div>
  );
}

export default function KnowledgeBasePage() {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || '';
  
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [selectedArticle, setSelectedArticle] = useState<KnowledgeBaseArticle | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | KnowledgeBaseArticle['category']>('all');
  
  const { profile, roles } = useAuth();
  const userRole = roles.includes('admin') ? 'admin' : 
                   roles.includes('leadership') ? 'leadership' : 
                   roles.includes('physician') ? 'physician' : 'provider';

  // Update search when URL param changes
  useEffect(() => {
    if (initialSearch) {
      setSearchQuery(initialSearch);
    }
  }, [initialSearch]);
  
  const filteredArticles = searchQuery 
    ? searchKnowledgeBase(searchQuery)
    : activeTab === 'all' 
      ? knowledgeBaseArticles 
      : getKnowledgeBaseByCategory(activeTab);
  
  const categoryCounts = {
    all: knowledgeBaseArticles.length,
    state_guides: getKnowledgeBaseByCategory('state_guides').length,
    sop: getKnowledgeBaseByCategory('sop').length,
    training: getKnowledgeBaseByCategory('training').length,
    compliance: getKnowledgeBaseByCategory('compliance').length,
    templates: getKnowledgeBaseByCategory('templates').length,
  };

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar 
        userRole={userRole}
        userName={profile?.full_name || 'User'}
        userEmail={profile?.email || ''}
        userAvatarUrl={profile?.avatar_url || undefined}
      />
      <main className="ml-16 lg:ml-64 transition-all duration-300 p-6">
        <div className="max-w-6xl mx-auto space-y-6">
            {selectedArticle ? (
              <ArticleDetail 
                article={selectedArticle} 
                onBack={() => setSelectedArticle(null)} 
              />
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-3xl font-bold flex items-center gap-3">
                      <BookOpen className="h-8 w-8 text-primary" />
                      Knowledge Base
                    </h1>
                    <p className="text-muted-foreground mt-1">
                      State guides, SOPs, training materials, and templates in one place
                    </p>
                  </div>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search articles, states, or topics..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-12"
                  />
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {Object.entries(categoryConfig).map(([key, config]) => {
                    const Icon = config.icon;
                    const count = categoryCounts[key as keyof typeof categoryCounts];
                    return (
                      <Card 
                        key={key} 
                        className={`cursor-pointer transition-all hover:shadow-md ${
                          activeTab === key ? 'ring-2 ring-primary' : ''
                        }`}
                        onClick={() => {
                          setActiveTab(key as KnowledgeBaseArticle['category']);
                          setSearchQuery('');
                        }}
                      >
                        <CardContent className="pt-4 pb-3">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${config.color}`}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="text-2xl font-bold">{count}</p>
                              <p className="text-xs text-muted-foreground">{config.label}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* Content Tabs */}
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
                  <TabsList>
                    <TabsTrigger value="all">All Articles</TabsTrigger>
                    <TabsTrigger value="state_guides">State Guides</TabsTrigger>
                    <TabsTrigger value="sop">SOPs</TabsTrigger>
                    <TabsTrigger value="training">Training</TabsTrigger>
                    <TabsTrigger value="compliance">Compliance</TabsTrigger>
                    <TabsTrigger value="templates">Templates</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value={activeTab} className="mt-6">
                    {searchQuery && (
                      <p className="text-sm text-muted-foreground mb-4">
                        {filteredArticles.length} result{filteredArticles.length !== 1 ? 's' : ''} for "{searchQuery}"
                      </p>
                    )}
                    
                    {filteredArticles.length === 0 ? (
                      <Card>
                        <CardContent className="py-12 text-center">
                          <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                          <h3 className="text-lg font-semibold mb-2">No articles found</h3>
                          <p className="text-muted-foreground">
                            {searchQuery 
                              ? `No articles match "${searchQuery}". Try a different search term.`
                              : 'No articles in this category yet.'}
                          </p>
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredArticles.map(article => (
                          <ArticleCard 
                            key={article.id} 
                            article={article} 
                            onClick={() => setSelectedArticle(article)}
                          />
                        ))}
                      </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
        </div>
      </main>
    </div>
  );
}
