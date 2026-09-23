# DESIGN.md - AutoYT Brand Style

## Visual Philosophy
- **Creator studio, dark-first:** A near-black workspace (Higgsfield-inspired) where generated media is the brightest thing on screen. Light mode stays fully supported as an explicit choice.
- **Creator Energy:** AutoYT yellow is the single accent: the current section, primary actions, selection, and progress. Never decoration.
- **One header, no sidebar:** Navigation lives in a single top header so every page gets the full width.
- **Logic-First:** 4pt spatial grid (4, 8, 12, 16, 24, 32, 48, 64, 96px).

## Core Tokens
- **Brand Yellow:** `#f9dc0b` (accent text on light surfaces: `#7a6600`)
- **Dark background:** `#0f1113` (header `rgb(15 17 19 / 0.82)` with blur); panels `#17191c`; hairlines `rgb(255 255 255 / 0.08)`
- **Light background:** `#F9F8F6` (Warm Paper); surfaces `#FFFFFF`; text `#1A1A1A`
- **Universal backdrop:** `.app-backdrop` in `src/index.css`, a 44px grid under a soft yellow glow, themed with `--app-backdrop-*`

## Typography
- **Functional UI:** Inter everywhere (nav 14px/500, labels 12–13px).
- **Studio titles:** Inter 800, uppercase, tight tracking, centered (the Marketing Studio hero title). Used for Creator Studio app titles and generation-page heroes.
- **Editorial headings:** Playfair Display for page titles such as Explore and Prompt Library.
- **Data/Meta:** JetBrains Mono for timings, counts, and keyboard hints.

## Navigation (src/components/AppHeader.tsx)
- 56px sticky header: logo · Explore · Image ▾ · Video ▾ · Audio ▾ · Research ▾ · Tools ▾ · Agents ▾ · Channels ▾, then search (⌘K), activity, theme, and account on the right.
- ▾ items open a mega menu on hover intent or keyboard: columns of rows with a 40px icon tile, a title, and a one-line description. The current page's tile turns yellow.
- The information architecture lives in one list, `src/utils/appNavigation.tsx`, which drives the header, the phone menu, quick search, and the Explore directory.
- Below 1120px the nav collapses into a full-screen menu with accordion groups.

## Generation pages
- **Left-panel layout** (Creator Studio `PANEL_APPS`: Layers, AI Influencer, AI Clipping, Motion Control, Vibe Motion, Lip Sync, Body Swap, Workflows): a 340px control column containing mode tabs, style cards, large dashed upload areas, a prompt card, and settings tiles (label above value), with a full-width yellow Generate button pinned at its foot. Beside it, a rounded stage with History / How it works tabs; the empty state is the uppercase studio title over a short explainer.
- **Image, Video, and Audio Studio** keep the composer-bar layout (results above, prompt bar below). **Marketing Studio and Cinema Studio** keep their bespoke hero + dock + gallery pages.
- On phones the panel stacks above the stage and the page scrolls; the Generate button stays sticky.

## Components
- **Primary Buttons:** Yellow background, charcoal text; hover darkens slightly.
- **Tiles and cards:** Minimal borders; separation comes from soft surfaces and offset shadows.
- **Popups:** Dialogs for detail views (Prompt Library), bottom sheets on phones.

## UI/UX Quality & Impeccable Mandate
- All UI/UX changes follow the global `impeccable` skill: tinted neutrals (no raw `#000` / `#fff` for text surfaces in dark mode), 150–250ms state transitions, visible `:focus-visible` rings in the accent, complete loading, empty, and error states, and layouts verified at desktop and 390px phone widths in both themes.
