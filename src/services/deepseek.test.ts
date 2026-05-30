import { afterEach, describe, expect, it, vi } from 'vitest';
import { rewriteScriptWithDeepSeek } from './deepseek';

describe('rewriteScriptWithDeepSeek', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rewrites through the server API without exposing provider keys to the browser', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, rewrittenText: 'rewritten script' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await rewriteScriptWithDeepSeek('original script');

    expect(result).toBe('rewritten script');
    expect(fetchMock).toHaveBeenCalledWith('/api/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'original script' }),
    });
  });

  it('surfaces server rewrite errors instead of returning mock text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Text generation provider is not configured.' }),
    }));

    await expect(rewriteScriptWithDeepSeek('original script')).rejects.toThrow('Text generation provider is not configured.');
  });
});
