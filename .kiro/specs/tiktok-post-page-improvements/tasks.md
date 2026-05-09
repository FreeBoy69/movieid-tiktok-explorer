# Implementation Plan: TikTok Post Page Improvements

## Overview

This implementation enhances the TikTok Explorer with intuitive navigation controls, proper browser history management, and consistent URL routing. The work is organized into discrete coding tasks that build incrementally, with property-based tests validating correctness properties and unit tests covering specific scenarios.

## Tasks

- [ ] 1. Set up testing infrastructure and data generators
  - Install fast-check library for property-based testing
  - Create test data generators (videoArb, playlistArb, navStateArb) in test utilities
  - Configure vitest for property tests with minimum 100 iterations
  - _Requirements: All (testing foundation)_

- [ ] 2. Implement enhanced route handler functions
  - [ ] 2.1 Implement enhanced writeDeepLink function
    - Add path-based routing for saved resources (/playlist/, /channel/, /post/)
    - Add query parameter routing for unsaved resources
    - Implement URL change detection to prevent duplicate history entries
    - Support both pushState and replaceState modes
    - _Requirements: 2.1, 2.2, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5_
  
  - [ ]* 2.2 Write property test for writeDeepLink
    - **Property 1: Navigation updates URL consistently**
    - **Validates: Requirements 1.3, 1.4, 2.1, 2.2, 2.5, 6.6**
  
  - [ ]* 2.3 Write property test for URL format matching
    - **Property 3: URL format matches resource type**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
  
  - [ ] 2.4 Implement enhanced readDeepLink function
    - Parse path-based routes (/post/, /playlist/, /channel/)
    - Parse query parameter routes for unsaved resources
    - Return normalized TikTokDeepLink object
    - Add validation for route patterns
    - _Requirements: 4.1, 4.2, 4.6, 7.4_
  
  - [ ]* 2.5 Write unit tests for readDeepLink
    - Test saved playlist URL parsing
    - Test saved channel URL parsing
    - Test saved post URL parsing
    - Test unsaved resource query param parsing
    - Test malformed URL handling
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 7.4, 7.5_

- [ ] 3. Checkpoint - Ensure route handler tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement slug collision handling in saved playlists manager
  - [ ] 4.1 Implement getAllExistingSlugs function
    - Query all saved playlist summaries
    - Return Set of existing slugs for collision detection
    - _Requirements: 3.6_
  
  - [ ] 4.2 Enhance slugifySavedPlaylistTitle with collision detection
    - Accept optional existingSlugs parameter
    - Detect slug collisions
    - Append timestamp suffix when collision detected
    - _Requirements: 3.6, 3.7_
  
  - [ ]* 4.3 Write property test for slug uniqueness
    - **Property 4: Slugs are unique within resource type**
    - **Validates: Requirements 3.6, 3.7**
  
  - [ ]* 4.4 Write unit tests for slug collision handling
    - Test basic slug generation
    - Test collision detection with existing slugs
    - Test timestamp suffix appending
    - Test edge cases (empty title, special characters)
    - _Requirements: 3.6, 3.7_

- [ ] 5. Implement TikTokExplorer navigation state management
  - [ ] 5.1 Add selectedVideoIndex state variable
    - Add useState hook for tracking current video index
    - Initialize to -1 when no video selected
    - _Requirements: 1.3, 1.4, 1.5, 1.6_
  
  - [ ] 5.2 Implement navigateToPrevious function
    - Check bounds (selectedVideoIndex > 0)
    - Update selectedVideo, selectedVideoIndex state
    - Call writeDeepLink with new post slug
    - Use useCallback for performance
    - _Requirements: 1.3, 1.5, 6.2_
  
  - [ ] 5.3 Implement navigateToNext function
    - Check bounds (selectedVideoIndex < playlist.length - 1)
    - Update selectedVideo, selectedVideoIndex state
    - Call writeDeepLink with new post slug
    - Use useCallback for performance
    - _Requirements: 1.4, 1.6, 6.3_
  
  - [ ] 5.4 Implement returnToGrid function
    - Set viewMode to "grid"
    - Clear selectedVideo and selectedVideoIndex
    - Generate playlist/channel slug using routeSlugForList
    - Call writeDeepLink with playlist/channel slug
    - Use useCallback for performance
    - _Requirements: 1.7, 2.2_
  
  - [ ]* 5.5 Write property test for navigation state consistency
    - **Property 6: Navigation state consistency**
    - **Validates: Requirements 2.7**
  
  - [ ]* 5.6 Write property test for prev/next bounds
    - **Property 8: Prev/next navigation bounds**
    - **Validates: Requirements 1.3, 1.4, 6.2, 6.3**
  
  - [ ]* 5.7 Write unit tests for navigation functions
    - Test navigateToPrevious at various indices
    - Test navigateToNext at various indices
    - Test boundary conditions (first/last video)
    - Test returnToGrid state clearing
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7_

- [ ] 6. Checkpoint - Ensure navigation state tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement keyboard navigation handler
  - [ ] 7.1 Create keyboard event handler with useEffect
    - Listen for keydown events when viewMode is "focused"
    - Handle ArrowLeft (call navigateToPrevious)
    - Handle ArrowRight (call navigateToNext)
    - Handle Escape (call returnToGrid)
    - Call preventDefault on all navigation keys
    - Clean up event listener on unmount
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  
  - [ ]* 7.2 Write property test for keyboard navigation equivalence
    - **Property 9: Keyboard navigation equivalence**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
  
  - [ ]* 7.3 Write property test for keyboard event prevention
    - **Property 10: Keyboard event prevention**
    - **Validates: Requirements 6.5**
  
  - [ ]* 7.4 Write unit tests for keyboard handler
    - Test left arrow key navigation
    - Test right arrow key navigation
    - Test escape key navigation
    - Test preventDefault called on all keys
    - Test handler only active in focused view
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 8. Implement FocusedViewNavigation UI component
  - [ ] 8.1 Create FocusedViewNavigation component
    - Accept props: onBack, onPrevious, onNext, hasPrevious, hasNext, showPrevNext
    - Render back button with ArrowLeft icon and "Back to Grid" text
    - Conditionally render prev/next buttons based on showPrevNext
    - Apply disabled state to prev button when !hasPrevious
    - Apply disabled state to next button when !hasNext
    - Use ChevronLeft and ChevronRight icons
    - Add keyboard shortcut hints in button titles
    - Apply consistent styling with hover states
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 5.1, 5.4_
  
  - [ ]* 8.2 Write property test for prev/next button state
    - **Property 7: Prev/next button state correctness**
    - **Validates: Requirements 1.5, 1.6**
  
  - [ ]* 8.3 Write property test for prev/next controls visibility
    - **Property 17: Prev/next controls visibility**
    - **Validates: Requirements 1.2**
  
  - [ ]* 8.4 Write unit tests for FocusedViewNavigation
    - Test back button always visible
    - Test prev/next hidden for single video playlist
    - Test prev/next visible for multi-video playlist
    - Test disabled states at boundaries
    - Test button click handlers called
    - _Requirements: 1.1, 1.2, 1.5, 1.6_

- [ ] 9. Integrate FocusedViewNavigation into TikTokExplorer focused view
  - [ ] 9.1 Add FocusedViewNavigation to focused view render
    - Calculate hasPrevious (selectedVideoIndex > 0)
    - Calculate hasNext (selectedVideoIndex < playlist.length - 1)
    - Calculate showPrevNext (playlist && playlist.videos.length > 1)
    - Pass navigation callbacks (returnToGrid, navigateToPrevious, navigateToNext)
    - Position component at top of focused view layout
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_
  
  - [ ]* 9.2 Write integration test for focused view navigation
    - Test clicking back button returns to grid
    - Test clicking prev button navigates to previous video
    - Test clicking next button navigates to next video
    - Test URL updates on each navigation action
    - _Requirements: 1.1, 1.3, 1.4, 1.7, 2.1, 2.5_

- [ ] 10. Checkpoint - Ensure UI component tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Implement browser history restoration with popstate handler
  - [ ] 11.1 Create popstate event handler with useEffect
    - Listen for popstate events
    - Call readDeepLink to get current URL state
    - Validate link.view is "tiktok"
    - Handle postSlug case (load focused view)
    - Handle slug case (load grid view)
    - Handle unsaved resource case (load from URL)
    - Clean up event listener on unmount
    - _Requirements: 2.3, 2.4, 2.6, 4.3_
  
  - [ ] 11.2 Implement loadSavedPost helper function
    - Accept postSlug parameter
    - Call getSavedPostBySlug to retrieve post data
    - If not found, set error message and return false
    - If found, set selectedVideo and viewMode to "focused"
    - Calculate and set selectedVideoIndex
    - Return true on success
    - _Requirements: 4.2, 4.4, 7.1_
  
  - [ ]* 11.3 Write property test for browser history restoration
    - **Property 2: Browser history restoration preserves view state**
    - **Validates: Requirements 2.3, 2.4, 2.6, 4.3**
  
  - [ ]* 11.4 Write property test for view mode matching URL
    - **Property 5: View mode matches URL pattern**
    - **Validates: Requirements 4.1, 4.2, 4.6**
  
  - [ ]* 11.5 Write property test for saved resource loading
    - **Property 11: Saved resource loading**
    - **Validates: Requirements 4.4**
  
  - [ ]* 11.6 Write unit tests for popstate handler
    - Test back button from focused to grid
    - Test forward button from grid to focused
    - Test sequential back navigation through multiple videos
    - Test invalid postSlug handling
    - Test missing saved resource handling
    - _Requirements: 2.3, 2.4, 2.6, 4.3, 7.1, 7.2_

- [ ] 12. Implement error handling for missing and invalid resources
  - [ ] 12.1 Add error state variable and setError function
    - Add useState hook for error messages
    - _Requirements: 7.1, 7.2, 7.3_
  
  - [ ] 12.2 Implement validateSlug helper function
    - Check slug matches pattern /^[a-z0-9-]+$/
    - Check slug length between 1 and 100 characters
    - Return boolean validation result
    - _Requirements: 7.4_
  
  - [ ] 12.3 Add error handling to loadSavedPost
    - Set user-friendly error message when post not found
    - Include recovery instructions in error message
    - Log technical details to console
    - Return to grid view on error
    - _Requirements: 7.1, 7.3, 7.6_
  
  - [ ] 12.4 Add error handling to popstate handler
    - Validate slug format before loading
    - Handle missing playlist/channel gracefully
    - Set appropriate error messages
    - Use replaceState for invalid URLs (don't push to history)
    - _Requirements: 7.2, 7.4, 7.5_
  
  - [ ] 12.5 Create error display UI component
    - Display error message with AlertCircle icon
    - Include dismiss button (X icon)
    - Include "Return to Home" action button
    - Use red color scheme for error state
    - Apply consistent styling with rest of app
    - _Requirements: 7.1, 7.2, 7.3_
  
  - [ ]* 12.6 Write property test for URL slug validation
    - **Property 12: URL slug validation**
    - **Validates: Requirements 7.4**
  
  - [ ]* 12.7 Write property test for error logging
    - **Property 13: Error logging without exposure**
    - **Validates: Requirements 7.6**
  
  - [ ]* 12.8 Write unit tests for error handling
    - Test invalid post slug error message
    - Test invalid playlist slug error message
    - Test malformed URL redirect
    - Test error UI rendering
    - Test error dismissal
    - Test return to home action
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 13. Checkpoint - Ensure error handling tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Implement visual design improvements for focused view
  - [ ] 14.1 Update focused view layout structure
    - Position FocusedViewNavigation at top with proper spacing
    - Apply visual hierarchy to emphasize video content
    - Use consistent spacing and typography
    - Ensure responsive layout for mobile/tablet/desktop
    - _Requirements: 5.1, 5.2, 5.6, 5.7_
  
  - [ ] 14.2 Enhance video statistics display
    - Use clear icons for stats (diggCount, commentCount, shareCount, playCount)
    - Apply readable formatting for large numbers
    - Use consistent icon sizing and spacing
    - _Requirements: 5.3_
  
  - [ ] 14.3 Add hover and focus states to interactive elements
    - Apply hover styles to all buttons
    - Add focus visible styles for keyboard navigation
    - Use transition animations for smooth feedback
    - _Requirements: 5.4_
  
  - [ ] 14.4 Add loading state to analyze button
    - Display loading spinner when analysis in progress
    - Disable button during loading
    - Show clear progress indication
    - _Requirements: 5.5_
  
  - [ ]* 14.5 Write property test for interactive element feedback
    - **Property 14: Interactive element feedback**
    - **Validates: Requirements 5.4**
  
  - [ ]* 14.6 Write property test for loading state visibility
    - **Property 15: Loading state visibility**
    - **Validates: Requirements 5.5**
  
  - [ ]* 14.7 Write property test for responsive layout
    - **Property 16: Responsive layout integrity**
    - **Validates: Requirements 5.6**
  
  - [ ]* 14.8 Write unit tests for visual design
    - Test navigation controls positioning
    - Test video statistics formatting
    - Test hover state classes applied
    - Test loading state rendering
    - Test responsive breakpoints
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [ ] 15. Wire all components together and update initialization logic
  - [ ] 15.1 Update component initialization to read URL on mount
    - Call readDeepLink on component mount
    - Handle postSlug case (restore focused view)
    - Handle slug case (restore grid view)
    - Handle unsaved URL case (analyze and display)
    - _Requirements: 4.1, 4.2, 4.6_
  
  - [ ] 15.2 Update video selection handler to use new navigation functions
    - Replace direct state updates with navigation functions
    - Ensure selectedVideoIndex is set when video selected
    - Call writeDeepLink with post slug
    - _Requirements: 1.3, 2.1_
  
  - [ ] 15.3 Ensure all URL updates use writeDeepLink consistently
    - Audit all navigation code paths
    - Replace any direct history manipulation with writeDeepLink
    - Ensure proper pushState vs replaceState usage
    - _Requirements: 2.1, 2.2, 2.5, 2.7_
  
  - [ ]* 15.4 Write integration test for complete navigation flow
    - Test grid → focused → grid flow with URL updates
    - Test sequential video navigation with history
    - Test browser back/forward through navigation history
    - Test deep link loading and restoration
    - Test keyboard navigation end-to-end
    - _Requirements: All navigation and history requirements_

- [ ] 16. Final checkpoint - Ensure all tests pass
  - Run full test suite (unit, property, integration)
  - Verify all 17 correctness properties pass
  - Ensure coverage goals met (>90% line, >85% branch)
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties using fast-check
- Unit tests validate specific examples and edge cases
- Integration tests validate complete user flows
- Checkpoints ensure incremental validation and provide opportunities for user feedback
