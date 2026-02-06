import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface KBArticle {
  id: string;
  title: string;
  slug: string | null;
  summary: string | null;
  content: string | null;
  content_type: 'rich_text' | 'markdown' | 'notion_link';
  notion_url: string | null;
  category: string;
  tags: string[];
  visibility_roles: string[];
  is_featured: boolean;
  featured_order: number | null;
  owner_id: string | null;
  owner_name: string | null;
  review_cycle_days: number;
  last_reviewed_at: string | null;
  last_reviewed_by: string | null;
  view_count: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  published: boolean;
}

export interface KBCategory {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  sort_order: number;
}

export function useKBArticles(category?: string) {
  return useQuery({
    queryKey: ['kb-articles', category],
    queryFn: async () => {
      let query = supabase
        .from('kb_articles')
        .select('*')
        .eq('published', true)
        .order('is_featured', { ascending: false })
        .order('updated_at', { ascending: false });

      if (category && category !== 'all') {
        query = query.eq('category', category);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as KBArticle[];
    },
  });
}

export function useKBArticle(id: string) {
  return useQuery({
    queryKey: ['kb-article', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kb_articles')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      // Increment view count
      await supabase
        .from('kb_articles')
        .update({ view_count: (data.view_count || 0) + 1 })
        .eq('id', id);

      return data as KBArticle;
    },
    enabled: !!id,
  });
}

export function useFeaturedArticles() {
  return useQuery({
    queryKey: ['kb-featured'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kb_articles')
        .select('*')
        .eq('published', true)
        .eq('is_featured', true)
        .order('featured_order', { ascending: true, nullsFirst: false })
        .limit(6);

      if (error) throw error;
      return data as KBArticle[];
    },
  });
}

export function useRecentlyUpdatedArticles(limit: number = 5) {
  return useQuery({
    queryKey: ['kb-recent', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kb_articles')
        .select('*')
        .eq('published', true)
        .order('updated_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data as KBArticle[];
    },
  });
}

export function useKBCategories() {
  return useQuery({
    queryKey: ['kb-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kb_categories')
        .select('*')
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return data as KBCategory[];
    },
  });
}

export function useArticlesNeedingReview() {
  return useQuery({
    queryKey: ['kb-needs-review'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kb_articles')
        .select('*')
        .eq('published', true);

      if (error) throw error;

      const now = new Date();
      return (data as KBArticle[]).filter(article => {
        if (!article.last_reviewed_at) return true;
        const lastReview = new Date(article.last_reviewed_at);
        const daysSinceReview = Math.floor((now.getTime() - lastReview.getTime()) / (1000 * 60 * 60 * 24));
        return daysSinceReview > article.review_cycle_days;
      });
    },
  });
}

export function useSearchKBArticles(query: string) {
  return useQuery({
    queryKey: ['kb-search', query],
    queryFn: async () => {
      if (!query.trim()) return [];

      const searchTerm = `%${query.toLowerCase()}%`;
      
      const { data, error } = await supabase
        .from('kb_articles')
        .select('*')
        .eq('published', true)
        .or(`title.ilike.${searchTerm},summary.ilike.${searchTerm}`)
        .order('updated_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return data as KBArticle[];
    },
    enabled: query.length >= 2,
  });
}

export function useCreateKBArticle() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (article: Partial<KBArticle>) => {
      const { data, error } = await supabase
        .from('kb_articles')
        .insert({
          title: article.title || 'Untitled',
          summary: article.summary,
          content: article.content,
          content_type: article.content_type || 'rich_text',
          notion_url: article.notion_url,
          category: article.category || 'General',
          tags: article.tags || [],
          visibility_roles: article.visibility_roles || ['provider'],
          is_featured: article.is_featured || false,
          owner_id: article.owner_id,
          owner_name: article.owner_name,
          review_cycle_days: article.review_cycle_days || 90,
          slug: article.title?.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kb-articles'] });
      queryClient.invalidateQueries({ queryKey: ['kb-featured'] });
      toast({ title: 'Article created successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error creating article', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdateKBArticle() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<KBArticle> & { id: string }) => {
      const { error } = await supabase
        .from('kb_articles')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kb-articles'] });
      queryClient.invalidateQueries({ queryKey: ['kb-featured'] });
      queryClient.invalidateQueries({ queryKey: ['kb-article'] });
      toast({ title: 'Article updated successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error updating article', description: error.message, variant: 'destructive' });
    },
  });
}

export function useMarkArticleReviewed() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (articleId: string) => {
      const { data: user } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from('kb_articles')
        .update({
          last_reviewed_at: new Date().toISOString(),
          last_reviewed_by: user.user?.id,
        })
        .eq('id', articleId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kb-needs-review'] });
      queryClient.invalidateQueries({ queryKey: ['kb-article'] });
      toast({ title: 'Article marked as reviewed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });
}

export function useBulkImportKBArticles() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (articles: Array<{
      title: string;
      category: string;
      tags?: string[];
      visibility_roles?: string[];
      notion_url?: string;
      summary?: string;
    }>) => {
      const { data: user } = await supabase.auth.getUser();

      const articlesToInsert = articles.map(article => ({
        title: article.title,
        summary: article.summary || null,
        content_type: article.notion_url ? 'notion_link' as const : 'rich_text' as const,
        notion_url: article.notion_url || null,
        category: article.category || 'General',
        tags: article.tags || [],
        visibility_roles: article.visibility_roles || ['provider'],
        slug: article.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      }));

      const { data, error } = await supabase
        .from('kb_articles')
        .insert(articlesToInsert)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['kb-articles'] });
      toast({ title: `Imported ${data.length} articles successfully` });
    },
    onError: (error: Error) => {
      toast({ title: 'Error importing articles', description: error.message, variant: 'destructive' });
    },
  });
}
