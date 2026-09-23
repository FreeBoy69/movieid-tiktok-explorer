import { PROMPT_CATEGORIES } from "./promptCategories.js";

export type PromptCategoryId = "visualStyle" | "thumbnail" | "idea" | "script" | "hook" | "narration" | "music";
export type LibraryPrompt = {
  id: string;
  title: string;
  act?: string;
  contributor?: string;
  categories: PromptCategoryId[];
  summary?: string;
  snippet: string;
  prompt?: string;
  tags?: string[];
  relevance?: number;
  favorite?: boolean;
  custom?: boolean;
  /** Example output hosted by prompts.chat. */
  image?: string;
  video?: string;
  url?: string;
};
export type PromptCategory = { id: PromptCategoryId; label: string; hint: string; count?: number };
export type PromptSource = { repo: string; commit: string; license: string } | null;

export const CATEGORIES = PROMPT_CATEGORIES as PromptCategory[];
export const categoryLabel = (id: string) => CATEGORIES.find((category) => category.id === id)?.label || id;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The prompt library is unavailable right now.");
  return data as T;
}
const query = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => [key, String(value)])).toString();

export function listPrompts(params: { q?: string; category?: string; saved?: boolean; primary?: boolean; offset?: number; limit?: number; accountId?: string }) {
  return request<{ total: number; items: LibraryPrompt[]; categories: PromptCategory[]; savedCount: number; source: PromptSource }>(
    `/api/prompts?${query({ ...params, saved: params.saved ? 1 : undefined, primary: params.primary ? 1 : undefined })}`,
  );
}
export function suggestPrompts(category: PromptCategoryId, context: string, accountId?: string, limit = 6) {
  return request<{ items: LibraryPrompt[] }>(`/api/prompts/suggest?${query({ category, context: context.slice(0, 1500), accountId, limit })}`);
}
const json = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export function setFavorite(id: string, favorite: boolean, accountId?: string) {
  return request<{ id: string; favorite: boolean }>("/api/prompts/favorites", json({ id, favorite, accountId }));
}
export function createPrompt(input: { title: string; categories: PromptCategoryId[]; snippet: string }, accountId?: string) {
  return request<{ item: LibraryPrompt }>("/api/prompts/custom", json({ ...input, accountId }));
}
export function deletePrompt(id: string, accountId?: string) {
  return request<{ ok: true }>(`/api/prompts/custom/${encodeURIComponent(id)}?${query({ accountId })}`, { method: "DELETE" });
}
