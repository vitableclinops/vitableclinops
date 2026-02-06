import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { NotionImportDialog } from '@/components/knowledge-base/NotionImportDialog';
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
  ChevronRight,
  Star,
  Rocket,
  Laptop,
  Users,
  HelpCircle,
  Stethoscope,
  Plus,
  Settings,
  AlertTriangle,
  RefreshCw,
  Upload
} from 'lucide-react';
import { 
  useKBArticles,
  useFeaturedArticles,
  useRecentlyUpdatedArticles,
  useKBCategories,
  useSearchKBArticles,
  useArticlesNeedingReview,
  type KBArticle,
  type KBCategory
} from '@/hooks/useKnowledgeBase';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

// Icon mapping for categories
const categoryIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  'Getting Started': Rocket,
  'State Guides': MapPin,
  'Clinical Resources': Stethoscope,
  'Compliance & Training': Shield,
  'HR & Benefits': Users,
  'Technology': Laptop,
  'Templates & Forms': FileText,
  'FAQs': HelpCircle,
};

function ArticleCard({ article, onClick }: { article: KBArticle; onClick: () => void }) {
  const Icon = categoryIcons[article.category] || FileText;
  
  return (
    <Card 
      className="cursor-pointer hover:shadow-md transition-shadow group"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </div>
            {article.is_featured && (
              <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300">
                <Star className="h-3 w-3 mr-1" />
                Featured
              </Badge>
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
            Updated {format(new Date(article.updated_at), 'MMM d, yyyy')}
          </span>
        </div>
        {article.tags && article.tags.length > 0 && (
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

function ArticleDetail({ article, onBack }: { article: KBArticle; onBack: () => void }) {
  const Icon = categoryIcons[article.category] || FileText;
  
  return (
    <div className="space-y-6">
      <button 
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        ← Back to Knowledge Base
      </button>
      
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-primary/10 text-primary">
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="secondary">{article.category}</Badge>
            {article.is_featured && (
              <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300">
                <Star className="h-3 w-3 mr-1" />
                Featured
              </Badge>
            )}
          </div>
          <h1 className="text-2xl font-bold">{article.title}</h1>
          <p className="text-muted-foreground mt-1">{article.summary}</p>
          <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Updated {format(new Date(article.updated_at), 'MMMM d, yyyy')}
            </span>
            {article.owner_name && (
              <span className="flex items-center gap-1">
                <Users className="h-4 w-4" />
                {article.owner_name}
              </span>
            )}
            {article.notion_url && (
              <a 
                href={article.notion_url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-foreground transition-colors text-primary"
              >
                <ExternalLink className="h-4 w-4" />
                View in Notion
              </a>
            )}
          </div>
        </div>
      </div>
      
      {article.content_type === 'notion_link' && article.notion_url ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ExternalLink className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">View in Notion</h3>
            <p className="text-muted-foreground mb-4">
              This article is hosted on Notion for rich formatting and collaboration.
            </p>
            <Button asChild>
              <a href={article.notion_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in Notion
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <ScrollArea className="h-[calc(100vh-400px)]">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                {article.content?.split('\n').map((line, i) => {
                  if (line.startsWith('# ')) {
                    return <h1 key={i} className="text-xl font-bold mt-6 mb-3">{line.replace('# ', '')}</h1>;
                  }
                  if (line.startsWith('## ')) {
                    return <h2 key={i} className="text-lg font-semibold mt-5 mb-2">{line.replace('## ', '')}</h2>;
                  }
                  if (line.startsWith('### ')) {
                    return <h3 key={i} className="text-base font-semibold mt-4 mb-2">{line.replace('### ', '')}</h3>;
                  }
                  if (line.startsWith('- ')) {
                    return <p key={i} className="ml-4 my-1">• {line.replace('- ', '')}</p>;
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
      )}
      
      {article.tags && article.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {article.tags.map(tag => (
            <Badge key={tag} variant="secondary">{tag}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function FeaturedSection({ articles, onSelect }: { articles: KBArticle[]; onSelect: (a: KBArticle) => void }) {
  if (!articles || articles.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Star className="h-5 w-5 text-amber-500" />
        <h2 className="text-lg font-semibold">Start Here</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {articles.map(article => (
          <ArticleCard key={article.id} article={article} onClick={() => onSelect(article)} />
        ))}
      </div>
    </div>
  );
}

function CategoryTiles({ categories, onSelect, selectedCategory }: { 
  categories: KBCategory[]; 
  onSelect: (cat: string) => void;
  selectedCategory: string;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {categories?.map(category => {
        const Icon = categoryIcons[category.name] || FileText;
        const isSelected = selectedCategory === category.name;
        
        return (
          <Card 
            key={category.id}
            className={cn(
              "cursor-pointer transition-all hover:shadow-md",
              isSelected && "ring-2 ring-primary"
            )}
            onClick={() => onSelect(isSelected ? 'all' : category.name)}
          >
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-medium text-sm">{category.name}</p>
                  {category.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1">{category.description}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function AdminPanel({ onImport }: { onImport: () => void }) {
  const { data: needsReview } = useArticlesNeedingReview();
  const { roles } = useAuth();
  
  if (!roles.includes('admin')) return null;

  return (
    <Card className="border-warning/30 bg-warning/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Admin Tools
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <span className="text-sm">
              {needsReview?.length || 0} articles need review
            </span>
          </div>
          {needsReview && needsReview.length > 0 && (
            <Button size="sm" variant="outline">
              <RefreshCw className="h-3 w-3 mr-1" />
              Review
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onImport}>
            <Upload className="h-3 w-3 mr-1" />
            Import from Notion
          </Button>
          <Button size="sm">
            <Plus className="h-3 w-3 mr-1" />
            New Article
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function KnowledgeBasePage() {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || '';
  
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<KBArticle | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showImport, setShowImport] = useState(false);
  
  const { profile, roles } = useAuth();
  const userRole = roles.includes('admin') ? 'admin' : 
                   roles.includes('leadership') ? 'leadership' : 
                   roles.includes('physician') ? 'physician' : 'provider';

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: categories, isLoading: categoriesLoading } = useKBCategories();
  const { data: featured, isLoading: featuredLoading } = useFeaturedArticles();
  const { data: recent, isLoading: recentLoading } = useRecentlyUpdatedArticles();
  const { data: articles, isLoading: articlesLoading } = useKBArticles(selectedCategory);
  const { data: searchResults } = useSearchKBArticles(debouncedSearch);

  const displayArticles = debouncedSearch ? searchResults : articles;
  const isLoading = categoriesLoading || featuredLoading || articlesLoading;

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
                    Provider Resources Hub
                  </h1>
                  <p className="text-muted-foreground mt-1">
                    State guides, SOPs, training materials, and resources in one place
                  </p>
                </div>
              </div>

              {/* Admin Panel */}
              <AdminPanel onImport={() => setShowImport(true)} />

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search articles, topics, or tags..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-12"
                />
              </div>

              {/* Featured Section */}
              {!debouncedSearch && !selectedCategory && featured && featured.length > 0 && (
                <FeaturedSection articles={featured} onSelect={setSelectedArticle} />
              )}

              {/* Category Tiles */}
              {!debouncedSearch && categories && (
                <CategoryTiles 
                  categories={categories} 
                  onSelect={setSelectedCategory}
                  selectedCategory={selectedCategory}
                />
              )}

              {/* Recently Updated */}
              {!debouncedSearch && selectedCategory === 'all' && recent && recent.length > 0 && (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Clock className="h-5 w-5 text-muted-foreground" />
                    Recently Updated
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {recent.slice(0, 3).map(article => (
                      <ArticleCard key={article.id} article={article} onClick={() => setSelectedArticle(article)} />
                    ))}
                  </div>
                </div>
              )}

              {/* All Articles / Search Results */}
              <div className="space-y-4">
                {debouncedSearch && (
                  <p className="text-sm text-muted-foreground">
                    {displayArticles?.length || 0} result{displayArticles?.length !== 1 ? 's' : ''} for "{debouncedSearch}"
                  </p>
                )}
                
                {selectedCategory !== 'all' && !debouncedSearch && (
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">{selectedCategory}</h2>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedCategory('all')}>
                      Clear filter
                    </Button>
                  </div>
                )}

                {isLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                      <Skeleton key={i} className="h-48" />
                    ))}
                  </div>
                ) : displayArticles && displayArticles.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {displayArticles.map(article => (
                      <ArticleCard key={article.id} article={article} onClick={() => setSelectedArticle(article)} />
                    ))}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-semibold mb-2">No articles found</h3>
                      <p className="text-muted-foreground">
                        {debouncedSearch 
                          ? `No articles match "${debouncedSearch}". Try a different search term.`
                          : 'No articles in this category yet.'}
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </>
          )}
        </div>
      </main>
      
      {/* Import Dialog */}
      <NotionImportDialog open={showImport} onOpenChange={setShowImport} />
    </div>
  );
}
