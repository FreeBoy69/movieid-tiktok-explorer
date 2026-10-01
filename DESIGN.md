# DESIGN.md - AutoYT Brand Style

## Visual Philosophy
- **Creator studio, dark-first:** A near-black workspace (Higgsfield-inspired) where generated media is the brightest thing on screen. Light mode stays fully supported as an explicit choice.
- **Creator Energy:** AutoYT yellow is the single accent: the current section, primary actions, selection, and progress. Never decoration.
- **One header, no sidebar:** Navigation lives in a single top header so every page gets the full width.
- **Logic-First:** 4pt spatial grid (4, 8, 12, 16, 24, 32, 48, 64, 96px).

## Core Tokens
- **Brand Yellow:** `#f9dc0b` (accent text on light surfaces: `#7a6600`)
- **Dark background:** `#0f1113` (frosted header and denser, blurred navigation popovers); panels `#17191c`; hairlines `rgb(255 255 255 / 0.08)`
- **Light background:** `#F9F8F6` (Warm Paper); surfaces `#FFFFFF`; text `#1A1A1A`
- **Universal backdrop:** `.app-backdrop` in `src/index.css`, a 44px grid under a soft yellow glow, themed with `--app-backdrop-*`

## Typography
- **Functional UI:** Inter everywhere (nav 14px/500, labels 12–13px).
- **Studio titles:** Inter 800, uppercase, tight tracking, centered (the Marketing Studio hero title). Used for Creator Studio app titles and generation-page heroes.
- **Editorial headings:** Playfair Display for page titles such as Explore and Prompt Library.
- **Data/Meta:** JetBrains Mono for timings, counts, and keyboard hints.

## Navigation (src/components/AppHeader.tsx)
- 56px sticky header: logo · Image · Video · Audio · Create Video · Create Drama · Marketing Studio · Promo Studio · Cinema Studio · Agents · Tools, then search (⌘K), activity, theme, and account on the right.
- Image, Video, and Audio are menu-only labels with their named Studio as the first choice. Create Video and Agents retain a direct link plus a focused hover menu; Create Drama is a top-level direct link. Tools opens a denser frosted popover for remaining utilities and research; all destinations remain available through quick search and the tool directory.
- The information architecture lives in `src/utils/appNavigation.tsx`, which drives the header, phone menu, quick search, and Explore directory.
- The nav is priority-plus: items that do not fit the row fold, right to left, into a "More" menu, so laptops and half-width windows keep the bar; the search pill shrinks to an icon below 1520px. Only below 760px does the row give way to the burger, which opens a phone sheet: a search field, then Studios and Tools as icon rows in cards with inline expansion, and the account plus a Light/Dark switch pinned at the foot.

## Generation pages
- **Left-column layout (Higgsfield, required for any app with a control column)**: on desktop the column runs the full height of the page below the header, inset 12px with a 12px gap, 340–384px wide, a 20px-radius surface with its own scroll. The app title and one-line description sit at its top, and the primary action (50px, full width) is pinned at its foot, never below the fold. Beside it, a full-height stage (also 20px radius) scrolls on its own; the page itself does not scroll. Reference: commit 0301ec2. Current users: the Tools suite (`src/components/tools/ToolPage.tsx` `ToolLayout`) and Editable Design (`.eds-composer`). On phones the column stacks above the stage and the page scrolls.
- **Image, Video, Audio, and every other `StudioGenerator` app** open on the composer-bar layout (centered prompt bar, like a chat box) while they have no results. Once the first generation is sent they switch to the full-height left column: title on top, fields and settings as tiles, the action pinned at its foot, results beside it. **Marketing Studio, Promo Studio, and Cinema Studio** keep their bespoke hero + dock + gallery pages (Promo Studio reuses Marketing Studio's `mks-*` styles).
- On phones the panel stacks above the stage and the page scrolls; the Generate button stays sticky.

## Components
- **Primary Buttons:** Yellow background, charcoal text; hover darkens slightly.
- **Tiles and cards:** Minimal borders; separation comes from soft surfaces and offset shadows.
- **Popups:** Dialogs for detail views (Prompt Library), bottom sheets on phones.

## UI/UX Quality & Impeccable Mandate
- All UI/UX changes follow the global `impeccable` skill: tinted neutrals (no raw `#000` / `#fff` for text surfaces in dark mode), 150–250ms state transitions, visible `:focus-visible` rings in the accent, complete loading, empty, and error states, and layouts verified at desktop and 390px phone widths in both themes.
