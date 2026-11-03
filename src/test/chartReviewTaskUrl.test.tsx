import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChartReviewTaskUrl } from '@/components/tasks/ChartReviewTaskUrl';

const mocks = vi.hoisted(() => ({ update: vi.fn(), toast: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({
  select: () => ({ eq: () => ({ single: async () => ({ data: { external_url: null }, error: null }) }) }),
  update: (payload: unknown) => {
    mocks.update(payload);
    return { eq: () => ({ select: () => ({ single: async () => ({ data: payload, error: null }) }) }) };
  },
}) } }));

describe('chart review task URL', () => {
  it('saves the task URL and rejects non-web links without changing completion', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChartReviewTaskUrl taskId="task" title="Link chart review calendar/tracker" /></QueryClientProvider>);
    const input = screen.getByLabelText('Chart review calendar/tracker URL');
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save URL' }));
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'https://example.org/tracker' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save URL' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ external_url: 'https://example.org/tracker' }));
    await waitFor(() => expect(screen.getByRole('link', { name: /Open calendar\/tracker/ })).toHaveAttribute('href', 'https://example.org/tracker'));
    cleanup(); client.clear();
  });
});