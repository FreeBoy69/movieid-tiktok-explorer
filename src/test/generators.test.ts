/**
 * Test suite for property-based test data generators
 * Feature: tiktok-post-page-improvements
 * 
 * Validates that generators produce valid test data
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  videoArb,
  playlistArb,
  playlistWithCountArb,
  slugArb,
  mainViewArb,
  listTabArb,
  savedDeepLinkArb,
  unsavedDeepLinkArb,
  deepLinkArb,
  navStateArb,
  validIndexForPlaylist,
  consistentNavStateArb,
  invalidSlugArb,
  malformedPathArb,
} from './generators';

describe('Feature: tiktok-post-page-improvements - Test Data Generators', () => {
  it('videoArb generates valid TikTok videos', () => {
    fc.assert(
      fc.property(videoArb, (video) => {
        expect(video.id).toBeTruthy();
        expect(video.title).toBeTruthy();
        expect(video.author).toBeTruthy();
        expect(video.authorHandle).toBeTruthy();
        expect(video.playUrl).toMatch(/^https?:\/\//);
        expect(video.dynamicCover).toMatch(/^https?:\/\//);
        expect(video.stats.diggCount).toBeGreaterThanOrEqual(0);
        expect(video.stats.shareCount).toBeGreaterThanOrEqual(0);
        expect(video.stats.commentCount).toBeGreaterThanOrEqual(0);
        expect(video.stats.playCount).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 }
    );
  });

  it('playlistArb generates valid TikTok playlists', () => {
    fc.assert(
      fc.property(playlistArb, (playlist) => {
        expect(playlist.title).toBeTruthy();
        expect(playlist.author).toBeTruthy();
        expect(playlist.videos).toBeInstanceOf(Array);
        expect(playlist.videos.length).toBeGreaterThan(0);
        expect(playlist.videos.length).toBeLessThanOrEqual(20);
      }),
      { numRuns: 100 }
    );
  });

  it('playlistWithCountArb generates playlists with specified video count', () => {
    fc.assert(
      fc.property(playlistWithCountArb(5, 10), (playlist) => {
        expect(playlist.videos.length).toBeGreaterThanOrEqual(5);
        expect(playlist.videos.length).toBeLessThanOrEqual(10);
      }),
      { numRuns: 100 }
    );
  });

  it('slugArb generates valid slugs', () => {
    fc.assert(
      fc.property(slugArb, (slug) => {
        expect(slug).toBeTruthy();
        expect(slug).toMatch(/^[a-z0-9-]+$/);
        expect(slug.length).toBeGreaterThan(0);
        expect(slug.length).toBeLessThanOrEqual(100);
        expect(slug).not.toMatch(/^-/); // No leading dash
        expect(slug).not.toMatch(/-$/); // No trailing dash
      }),
      { numRuns: 100 }
    );
  });

  it('mainViewArb generates valid MainView values', () => {
    fc.assert(
      fc.property(mainViewArb, (view) => {
        expect(['movie', 'tiktok', 'rewriter']).toContain(view);
      }),
      { numRuns: 100 }
    );
  });

  it('listTabArb generates valid ListTab values', () => {
    fc.assert(
      fc.property(listTabArb, (tab) => {
        expect(['collection', 'channel']).toContain(tab);
      }),
      { numRuns: 100 }
    );
  });

  it('savedDeepLinkArb generates valid saved resource links', () => {
    fc.assert(
      fc.property(savedDeepLinkArb, (link) => {
        expect(link.view).toBe('tiktok');
        if (link.postSlug) {
          expect(link.postSlug).toMatch(/^[a-z0-9-]+$/);
          expect(link.slug).toBeUndefined();
          expect(link.tab).toBeUndefined();
        } else {
          expect(link.slug).toMatch(/^[a-z0-9-]+$/);
          expect(['collection', 'channel']).toContain(link.tab!);
          expect(link.postSlug).toBeUndefined();
        }
      }),
      { numRuns: 100 }
    );
  });

  it('unsavedDeepLinkArb generates valid unsaved resource links', () => {
    fc.assert(
      fc.property(unsavedDeepLinkArb, (link) => {
        expect(link.view).toBe('tiktok');
        expect(['collection', 'channel']).toContain(link.tab!);
        expect(link.url).toMatch(/^https?:\/\//);
        expect(link.slug).toBeUndefined();
        expect(link.postSlug).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('deepLinkArb generates valid deep links', () => {
    fc.assert(
      fc.property(deepLinkArb, (link) => {
        expect(link.view).toBe('tiktok');
        // Either saved or unsaved format
        const isSaved = link.postSlug || link.slug;
        const isUnsaved = link.url;
        expect(isSaved || isUnsaved).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('navStateArb generates valid navigation states', () => {
    fc.assert(
      fc.property(navStateArb, (state) => {
        expect(['grid', 'focused']).toContain(state.viewMode);
        expect(state.selectedIndex).toBeGreaterThanOrEqual(0);
        expect(state.selectedIndex).toBeLessThanOrEqual(19);
        expect(['collection', 'channel']).toContain(state.listTab);
      }),
      { numRuns: 100 }
    );
  });

  it('validIndexForPlaylist generates valid indices', () => {
    fc.assert(
      fc.property(playlistArb, (playlist) => {
        const indexArb = validIndexForPlaylist(playlist);
        return fc.assert(
          fc.property(indexArb, (index) => {
            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThan(playlist.videos.length);
          }),
          { numRuns: 10 }
        );
      }),
      { numRuns: 10 }
    );
  });

  it('consistentNavStateArb generates states consistent with playlist', () => {
    fc.assert(
      fc.property(playlistArb, (playlist) => {
        const stateArb = consistentNavStateArb(playlist);
        return fc.assert(
          fc.property(stateArb, (state) => {
            expect(state.selectedIndex).toBeGreaterThanOrEqual(0);
            expect(state.selectedIndex).toBeLessThan(playlist.videos.length);
          }),
          { numRuns: 10 }
        );
      }),
      { numRuns: 10 }
    );
  });

  it('invalidSlugArb generates invalid slugs', () => {
    fc.assert(
      fc.property(invalidSlugArb, (slug) => {
        const isValid = 
          slug.length > 0 &&
          slug.length <= 100 &&
          /^[a-z0-9-]+$/.test(slug) &&
          !slug.startsWith('-') &&
          !slug.endsWith('-');
        expect(isValid).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('malformedPathArb generates malformed URL paths', () => {
    fc.assert(
      fc.property(malformedPathArb, (path) => {
        expect(path).toBeTruthy();
        // Should not match valid patterns
        const validPatterns = [
          /^\/post\/[a-z0-9-]+$/,
          /^\/playlist\/[a-z0-9-]+$/,
          /^\/channel\/[a-z0-9-]+$/,
        ];
        const isValid = validPatterns.some(pattern => pattern.test(path));
        expect(isValid).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
