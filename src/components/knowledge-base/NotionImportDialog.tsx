import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { useBulkImportKBArticles } from '@/hooks/useKnowledgeBase';

interface ImportArticle {
  title: string;
  category: string;
  tags?: string[];
  visibility_roles?: string[];
  notion_url?: string;
  summary?: string;
}

interface NotionImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NotionImportDialog({ open, onOpenChange }: NotionImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMethod, setImportMethod] = useState<'csv' | 'json' | 'manual'>('manual');
  const [parsedArticles, setParsedArticles] = useState<ImportArticle[]>([]);
  const [manualJson, setManualJson] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  
  const bulkImport = useBulkImportKBArticles();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParseError(null);
    const reader = new FileReader();

    reader.onload = (event) => {
      const content = event.target?.result as string;
      
      try {
        if (file.name.endsWith('.json')) {
          const data = JSON.parse(content);
          const articles = Array.isArray(data) ? data : [data];
          setParsedArticles(articles);
          setImportMethod('json');
        } else if (file.name.endsWith('.csv')) {
          const lines = content.split('\n');
          const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
          
          const articles: ImportArticle[] = [];
          for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            if (values.length < 2) continue;
            
            const article: ImportArticle = {
              title: values[headers.indexOf('title')] || `Untitled ${i}`,
              category: values[headers.indexOf('category')] || 'General',
              summary: values[headers.indexOf('summary')] || undefined,
              notion_url: values[headers.indexOf('notion_url')] || undefined,
              tags: values[headers.indexOf('tags')]?.split(';').filter(Boolean) || [],
              visibility_roles: values[headers.indexOf('visibility_roles')]?.split(';').filter(Boolean) || ['provider'],
            };
            articles.push(article);
          }
          
          setParsedArticles(articles);
          setImportMethod('csv');
        } else {
          setParseError('Unsupported file format. Please use .json or .csv');
        }
      } catch (error: any) {
        setParseError(`Failed to parse file: ${error.message}`);
      }
    };

    reader.readAsText(file);
  };

  const handleManualParse = () => {
    setParseError(null);
    try {
      const data = JSON.parse(manualJson);
      const articles = Array.isArray(data) ? data : [data];
      setParsedArticles(articles);
    } catch (error: any) {
      setParseError(`Invalid JSON: ${error.message}`);
    }
  };

  const handleImport = async () => {
    if (parsedArticles.length === 0) return;
    
    await bulkImport.mutateAsync(parsedArticles);
    setParsedArticles([]);
    setManualJson('');
    onOpenChange(false);
  };

  const handleClose = () => {
    setParsedArticles([]);
    setManualJson('');
    setParseError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import from Notion</DialogTitle>
          <DialogDescription>
            Import your Notion pages as Knowledge Base articles. Upload a CSV/JSON export or paste JSON manually.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* File Upload */}
          <div className="space-y-2">
            <Label>Upload File</Label>
            <div 
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Click to upload a CSV or JSON file
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                CSV format: title, category, tags, visibility_roles, notion_url, summary
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>

          {/* Or Manual JSON */}
          <div className="space-y-2">
            <Label>Or Paste JSON</Label>
            <Textarea
              value={manualJson}
              onChange={(e) => setManualJson(e.target.value)}
              placeholder={`[
  {
    "title": "Article Title",
    "category": "Getting Started",
    "notion_url": "https://notion.so/...",
    "summary": "Brief description",
    "tags": ["onboarding", "guide"],
    "visibility_roles": ["provider"]
  }
]`}
              className="font-mono text-xs h-32"
            />
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleManualParse}
              disabled={!manualJson.trim()}
            >
              Parse JSON
            </Button>
          </div>

          {/* Parse Error */}
          {parseError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          )}

          {/* Preview */}
          {parsedArticles.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                Preview ({parsedArticles.length} articles)
              </Label>
              <ScrollArea className="h-48 border rounded-md p-3">
                <div className="space-y-2">
                  {parsedArticles.map((article, i) => (
                    <div key={i} className="flex items-start gap-3 p-2 bg-muted/50 rounded">
                      <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{article.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs">{article.category}</Badge>
                          {article.notion_url && (
                            <Badge variant="outline" className="text-xs">Notion Link</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleImport} 
            disabled={parsedArticles.length === 0 || bulkImport.isPending}
          >
            {bulkImport.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Import {parsedArticles.length} Articles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
