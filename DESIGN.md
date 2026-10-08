# DESIGN.md - AutoYT Brand Style

## Visual Philosophy
- **Creator studio, dark-first:** A near-black workspace (Higgsfield-inspired) where generated media is the brightest thing on screen. Light mode stays fully supported as an explicit choice.
- **Creator Energy:** AutoYT yellow is the single accent: the current section, primary actions, selection, and progress. Never decoration.
- **One header, no sidebar:** Navigation lives in a single top header so every page gets the full width.
- **Logic-First:** 4pt spatial grid (4, 8, 12, 16, 24, 32, 48, 64, 96px).

## Core Tokens
- **Brand Yellow:** `#f9dc0b` (accent text on light surfaces: `#7a6600`)
- **Shared surfaces (`--ui-*` in `src/index.css`, the Vibe Edit palette, HyperFrames-style finish):** light `--ui-bg #efede8` (warm paper), panels `#fdfcfa`, inputs `#fbfaf7`, chips `#e3e0d9`, text `#1b1b18`; dark `--ui-bg #0e1012`, panels `#15171a`, raised `#1c1f23`, text `#eceae3`; hairlines at 8–9% and 16–20%; soft shadows; 18–20px panel radius. New pages use these tokens instead of their own colours.
- **Flat background:** the page and the header share `--ui-bg`. `.app-backdrop` no longer draws the grid or glow (the variables remain, set to transparent).
- **Inputs:** chat boxes and `.glass-input` are solid paper with a hairline border and a soft shadow, not frosted glass. Scrollbars are neutral, not yellow.

## Typography
- **Functional UI:** Inter everywhere (nav 14px/500, labels 12–13px).
- **Studio titles:** Inter 800, uppercase, tight tracking, centered (the Marketing Studio hero title). Used for Creator Studio app titles and generation-page heroes.
- **Headings stay Antonio** (`--font-serif`), including the Create page title and section headings.
- **Data/Meta:** JetBrains Mono for timings, counts, and keyboard hints.

## Navigation (src/components/AppHeader.tsx)
- 56px sticky header: logo · Image · Video · Audio · Create Video · Create Drama · Marketing Studio · Promo Studio · Cinema Studio · Agents · Tools, then search (⌘K), activity, theme, and account on the right.
- Image, Video, and Audio are menu-only labels with their named Studio as the first choice. Create Video and Agents retain a direct link plus a focused hover menu; Create Drama is a top-level direct link. Tools opens a denser frosted popover for remaining utilities and research; all destinations remain available through quick search and the tool directory.
- The information architecture lives in `src/utils/appNavigation.tsx`, which drives the header, phone menu, quick search, and the All tools tab on the Create page.
- The nav is priority-plus: items that do not fit the row fold, right to left, into a "More" menu, so laptops and half-width windows keep the bar; the search pill shrinks to an icon below 1520px. Only below 760px does the row give way to the burger, which opens a phone sheet: a search field, then Studios and Tools as icon rows in cards with inline expansion, and the account plus a Light/Dark switch pinned at the foot.

## Generation pages
- **Create home page (`/`, `src/components/CreateHub.tsx`)** follows HyperFrames' home layout in AutoYT branding: a big Antonio title, one chat box (dashed reference-card stack on its top-left corner, Image/Video toggle and a model dropdown inside the box, round send button), then "Get inspired" with icon tabs and a masonry grid of template cards (still image or a text card, title and byline under it, tab chip on the right). Templates come from `src/utils/createTemplates.ts`; a style rides along in the prompt, a workspace template opens its studio through the pending-template hand-off (`src/utils/promptTemplates.ts`).
- **Studio layout (required for every studio and tool): `src/components/StudioLayout.tsx`**. Every studio and mini tool uses one layout, the same as the Create home page: a back link where there is one, an Antonio title and a one-line intro, mode switches as a row above the box, then **one chat box** (`.sl-box`, 20px radius on `--ui-input`) holding the inputs, with settings as chips and the action at its foot (a round send button, or the studio's own Generate button). Notices sit under the box, then **tabs below** (the shared ui `Tabs`, restyled as rounded tabs) for results, templates and options, with masonry cards (`LayoutCard`) for templates. It replaces the Higgsfield full-height left column and the centered composer bar.
- **Where it applies:** Image/Video/Music and the other `StudioGenerator` apps (tabs Your creations / Templates). The mini tools via `ToolLayout` (controls in the box, results panel below). Marketing, Promo, Cinema and Explainer (their docks are the box; Your ads/films/shots plus Templates/Styles/Formats tabs). Audio Studio (the script is the box; voice, engine and language in its bar). The Create Video and Create Film start screens. Project editors (Create Video stages, the Explainer script editor, series pages, Vibe Edit) stay full workspaces.
- On phones the panel stacks above the stage and the page scrolls; the Generate button stays sticky.

## Components
- **Primary Buttons:** Yellow background, charcoal text; hover darkens slightly.
- **Tiles and cards:** Minimal borders; separation comes from soft surfaces and offset shadows.
- **Popups:** Dialogs for detail views (Prompt Library), bottom sheets on phones.

## UI/UX Quality & Impeccable Mandate
- All UI/UX changes follow the global `impeccable` skill: tinted neutrals (no raw `#000` / `#fff` for text surfaces in dark mode), 150–250ms state transitions, visible `:focus-visible` rings in the accent, complete loading, empty, and error states, and layouts verified at desktop and 390px phone widths in both themes.
