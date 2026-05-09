/**
 * Property-based test data generators for TikTok Post Page Improvements
 * 
 * These generators create random but valid test data for property-based testing
 * using fast-check library. Minimum 100 iterations per property test.
 */

import fc from 'fast-check';
import type { TikTokVideo, TikTokPlaylist } from '../services/tiktok';
import type { TikTokDeepLink, MainView, ListTab } from '../utils/tiktokRoute';

/**
 * Generate a random TikTok video with valid structure
 */
export const videoArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 30 }),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  author: fc.string({ minLength: 1, maxLength: 50 }),
  authorHandle: fc.string({ minLength: 1, maxLength: 30 }).map(s => s.replace(/[^a-z0-9_]/gi, '')),
  uploaderUrl: fc.option(fc.webUrl(), { nil: undefined }),
  uploaderId: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  playUrl: fc.webUrl(),
  dynamicCover: fc.webUrl(),
  stats: fc.record({
    diggCount: fc.nat({ max: 10000000 }),
    shareCount: fc.nat({ max: 1000000 }),
    commentCount: fc.nat({ max: 100000 }),
    playCount: fc.nat({ max: 100000000 }),
  }),
}) as fc.Arbitrary<TikTokVideo>;

/**
 * Generate a random TikTok playlist with 1-20 videos
 */
export const playlistArb = fc.record({
  title: fc.string({ minLength: 1, maxLength: 100 }),
  author: fc.string({ minLength: 1, maxLength: 50 }),
  videos: fc.array(videoArb, { minLength: 1, maxLength: 20 }),
}) as fc.Arbitrary<TikTokPlaylist>;

/**
 * Generate a playlist with a specific number of videos
 */
export const playlistWithCountArb = (minVideos: number, maxVideos: number) =>
  fc.record({
    title: fc.string({ minLength: 1, maxLength: 100 }),
    author: fc.string({ minLength: 1, maxLength: 50 }),
    videos: fc.array(videoArb, { minLength: minVideos, maxLength: maxVideos }),
  }) as fc.Arbitrary<TikTokPlaylist>;

/**
 * Generate a valid slug (lowercase alphanumeric with hyphens)
 */
export const slugArb = fc
  .string({ minLength: 1, maxLength: 70 })
  .map(s =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  )
  .filter(s => s.length > 0);

/**
 * Generate a MainView type
 */
export const mainViewArb = fc.constantFrom<MainView>('movie', 'tiktok', 'rewriter');

/**
 * Generate a ListTab type
 */
export const listTabArb = fc.constantFrom<ListTab>('collection', 'channel');

/**
 * Generate a TikTok deep link for saved resources (path-based)
 */
export const savedDeepLinkArb = fc.oneof(
  // Saved playlist
  fc.record({
    view: fc.constant<MainView>('tiktok'),
    tab: fc.constant<ListTab>('collection'),
    slug: slugArb,
  }),
  // Saved channel
  fc.record({
    view: fc.constant<MainView>('tiktok'),
    tab: fc.constant<ListTab>('channel'),
    slug: slugArb,
  }),
  // Saved post
  fc.record({
    view: fc.constant<MainView>('tiktok'),
    postSlug: slugArb,
  })
) as fc.Arbitrary<TikTokDeepLink>;

/**
 * Generate a TikTok deep link for unsaved resources (query param based)
 */
export const unsavedDeepLinkArb = fc.record({
  view: fc.constant<MainView>('tiktok'),
  tab: listTabArb,
  url: fc.webUrl(),
}) as fc.Arbitrary<TikTokDeepLink>;

/**
 * Generate any valid TikTok deep link
 */
export const deepLinkArb = fc.oneof(
  savedDeepLinkArb,
  unsavedDeepLinkArb
) as fc.Arbitrary<TikTokDeepLink>;

/**
 * Generate navigation state (view mode, selected index, etc.)
 */
export const navStateArb = fc.record({
  viewMode: fc.constantFrom('grid', 'focused'),
  selectedIndex: fc.nat({ max: 19 }), // Max 20 videos in playlist
  listTab: listTabArb,
});

/**
 * Generate a valid video index for a given playlist
 */
export const validIndexForPlaylist = (playlist: TikTokPlaylist) =>
  fc.nat({ max: Math.max(0, playlist.videos.length - 1) });

/**
 * Generate a navigation state that's consistent with a playlist
 */
export const consistentNavStateArb = (playlist: TikTokPlaylist) =>
  fc.record({
    viewMode: fc.constantFrom('grid', 'focused'),
    selectedIndex: validIndexForPlaylist(playlist),
    listTab: listTabArb,
  });

/**
 * Generate an invalid slug (for error testing)
 */
export const invalidSlugArb = fc.oneof(
  fc.constant(''), // Empty
  fc.string({ minLength: 101, maxLength: 200 }), // Too long
  fc.string().filter(s => /[^a-z0-9-]/.test(s) && s.length > 0), // Invalid characters
  fc.constant('UPPERCASE'), // Uppercase (invalid)
  fc.constant('has spaces'), // Spaces (invalid)
  fc.constant('has@special!chars'), // Special chars (invalid)
);

/**
 * Generate a malformed URL path
 */
export const malformedPathArb = fc.oneof(
  fc.constant('/post/'), // Missing slug
  fc.constant('/playlist/'), // Missing slug
  fc.constant('/channel/'), // Missing slug
  fc.constant('/invalid/something'), // Invalid prefix
  fc.constant('//double-slash'), // Double slash
);
