import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePhysicianCapacity } from '@/hooks/usePhysicianCapacity';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from } }));

describe('saved physician capacity', () => {
  beforeEach(() => { from.mockReset(); });

  it('treats a saved unlimited state as unlimited even if the cached fallback had a limit', async () => {
    const single = vi.fn().mockResolvedValue({ data: { np_md_ratio_limit: null }, error: null });
    const eq = vi.fn().mockReturnValue({ single });
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });
    const { result } = renderHook(() => usePhysicianCapacity('physician@example.com', 'PA', 2));
    await waitFor(() => expect(single).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.capacity).toBeNull();
    expect(from).toHaveBeenCalledTimes(1);
  });
});