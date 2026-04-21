import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import guideMd from '@/content/usability-audit.md?raw';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

export default function UsabilityGuidePage() {
  const { profile, roles } = useAuth();
  const userRole = roles.includes('admin')
    ? 'admin'
    : roles.includes('physician')
    ? 'physician'
    : roles.includes('pod_lead')
    ? 'pod_lead'
    : 'provider';

  const handleDownload = () => {
    const blob = new Blob([guideMd], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'USABILITY_AUDIT_AND_GUIDE.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        userRole={userRole}
        userName={profile?.full_name || 'User'}
        userEmail={profile?.email || ''}
        userAvatarUrl={profile?.avatar_url || undefined}
      />
      <main className="ml-16 lg:ml-64 transition-all duration-300 min-w-0">
        <div className="p-4 md:p-6 lg:p-8 max-w-4xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold">Usability Audit & User Guide</h1>
              <p className="text-muted-foreground mt-1">
                Page-by-page reference for every workflow in the platform.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-2" />
              Download .md
            </Button>
          </div>

          <Card>
            <CardContent className="py-8">
              <article className="prose prose-sm md:prose-base max-w-none dark:prose-invert prose-headings:font-semibold prose-h1:text-2xl prose-h2:text-xl prose-h2:mt-8 prose-h3:text-lg prose-a:text-primary prose-code:text-foreground prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{guideMd}</ReactMarkdown>
              </article>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
