export async function rewriteScriptWithDeepSeek(originalText: string): Promise<string> {
  const text = originalText.trim();
  if (!text) {
    throw new Error('No script text was provided.');
  }

  const response = await fetch('/api/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `Rewrite failed (${response.status})`);
  }

  const rewritten = String(data.rewrittenText || '').trim();
  if (!rewritten) {
    throw new Error('Rewrite provider returned an empty script.');
  }

  return rewritten;
}
