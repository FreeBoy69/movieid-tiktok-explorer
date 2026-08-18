# AutoYT Agent Chat Interface Extension

## Purpose and boundary

This is a focused design-and-behavior record for the agent-chat extension implemented in `src/components/AutomationAgents.tsx` and its supporting styles in `src/index.css`. It extends the existing AutoYT editorial system; [DESIGN.md](../../DESIGN.md) remains the canonical global identity and is not redefined here.

The surface helps a creator ask an automation agent a natural-language question, follow work in progress, read a response, and take a relevant follow-up action without leaving the conversation. It deliberately avoids a dashboard-within-a-dashboard: the reading column is quiet, the assistant prose is open, and the composer is the single clearly elevated object.

This record does not introduce global tokens, a new type scale, a new brand identity, or a replacement for any other AutoYT workspace surface.

## Direction realized

- **Operating-partner posture:** the agent presents as a named collaborator with progress and actionable results, rather than a generic widget or a grid of equally weighted cards.
- **Editorial hierarchy:** warm paper, deep charcoal, serif question/heading treatment, and restrained Inter utility copy preserve the incumbent AutoYT character.
- **One yellow signal:** `#f9dc0b` appears for the active-history tint, agent identity mark, confident actions, and composer/send emphasis. It is not used as a page-wide fill.
- **Conversational restraint:** assistant responses have no containing card. User turns are compact neutral bubbles; rich reports and metrics may become bordered sub-surfaces only when the response needs structured information.
- **Reference boundary:** the Claude-inspired conversational *form* is adapted to AutoYT. No Claude name, logo, color system, copy, or screenshot asset is part of the shipped interface.

## Layout and hierarchy

### Desktop workspace

At `lg` (1024px and up), the chat history is a left rail, open by default, with a width of 17.5rem. It contains the agent label, a new-chat control, collapse control, searchable saved conversations, timestamps, message preview, and a delete affordance. The current conversation has a 1px yellow leading accent plus a light yellow tint; it is not rendered as a large boxed selection.

The remaining space is a vertically scrollable conversation panel. Its reading column is centered at `max-w-3xl`; individual assistant prose is capped at 76 characters and rich prose at 72 characters. This keeps long answers readable while allowing full-width structured output where needed. If the rail is collapsed, lightweight floating controls restore history or begin a new chat without adding a permanent header band.

The active composer is anchored in a bottom dock at `max-w-2xl`. A paper-to-transparent fade behind it (`agent-chat-composer-dock`) makes it feel attached to the message stream without creating a separate footer. Compact quick actions sit immediately above it.

### Empty conversation

With no messages, the panel centers one editorial question — “What should [agent] do next?” — followed by one sentence describing the scope, the composer, and horizontally scrollable capability prompts. The composer remains the dominant control. If an agent has not yet been saved, a separate dashed, explanatory empty state communicates that prerequisite instead of presenting a non-working chat form.

### Message rhythm

- **User:** right-aligned, neutral charcoal-tint bubble, compact width (`90%` at the narrowest width; `78%` from `sm` upward), 18px rounded shell with a smaller lower-right corner, and no pronounced shadow.
- **Assistant:** left-aligned and unboxed, beginning with a small yellow identity mark, agent name, and time/meta line. The response action row is separated by a quiet top rule; Copy remains present but visually secondary.
- **Structured results:** report blocks, cards, sanitized rich HTML, applied-change confirmation, and action buttons occur below assistant prose. A `run_candidate` action is the one strong yellow response action; navigation and other actions remain outlined/neutral.
- **Progress and recovery:** streaming work appears in the normal message rhythm through a polite status line, not a modal. Errors are inline alerts with retry (when a message can be restored) and dismiss controls. A “latest message” button appears only after the user scrolls away from the bottom.

## Composer and controls

The composer is a 22px rounded, elevated shell. In light mode it uses `#FFFDF8` over the warm-paper workspace with a soft charcoal shadow; in dark mode it uses `#191C18` with a deeper black shadow. Pointer focus subtly strengthens the neutral border and shadow without adding a colored halo; keyboard focus keeps a muted neutral outline. The textarea starts at 60px, grows to a 200px maximum, and carries an explicit accessible name.

The contextual footer is deliberately quiet: it stays absent during normal composition, then shows a character count near the 2,000-character limit or listening/transcription state when voice input is active. Circular microphone, stop, and send controls provide the main actions. Send is yellow; stop appears only while an answer is in progress.

Suggested prompts and quick actions are compact, bordered, horizontally scrollable controls. They use 44px tap targets on narrow screens (`h-11`) and condense to 36px where the wider layout affords a denser presentation.

## Responsive behavior

At widths below `lg`, history is removed from the inline layout and opened as a fixed drawer. The drawer is `min(20rem, 90vw)`, sits over a dimmed scrim, has a visible close control, and locks document scrolling while open. Selecting a conversation or starting a new conversation closes the drawer and returns the creator to the conversation surface. The 390px mobile-history capture confirms that the main conversation remains visually behind the drawer rather than being squeezed beside it.

The mobile conversation keeps the same response hierarchy, but allows response actions to wrap vertically when necessary. The composer stays at the bottom of the viewport and its circular actions retain 44px targets. Prompt/action rows remain horizontally scrollable rather than forcing labels into unreadable wraps. The 390px mobile capture confirms readable assistant prose, compact stacked response actions, and an unobstructed composer.

## Theme, motion, and accessibility decisions

Light mode uses the incumbent warm paper (`#F9F8F6`), charcoal (`#1A1A1A`), soft neutral borders, and AutoYT yellow. Dark mode maps the workspace to deep green-charcoal surfaces with warm off-white text (`#F8F5E8`) while retaining yellow as the shared interaction signal. The dock fade, surfaces, borders, and text all have dark-mode counterparts.

Message arrival and progress-copy transitions use opacity and transform, with 180–320ms timing; no layout property is animated for the chat-message entrance. `prefers-reduced-motion: reduce` removes the chat-message, thinking-status, and voice-wave animations.

Accessibility decisions implemented for this extension include:

- Icon-only controls expose names for history, search clearing, new chat, delete, voice, send, stop, retry, dismiss, copy, and return-to-latest actions.
- The active history item carries `aria-current="page"`; search has an explicit label; suggested prompts are grouped with an accessible group label.
- Chat progress uses `role="status"`, polite live announcements, and atomic updates. Chat failures use `role="alert"`.
- History and response actions have a visible yellow `:focus-visible` outline; composer controls use a muted neutral keyboard outline, while pointer focus uses only a subtle border and shadow change.
- Enter sends a message; Shift+Enter creates a line break; composition events do not accidentally send. The send control and form submission provide a non-keyboard path.
- Voice input is capability-aware, exposes listening/transcription state, returns focus to the textarea after completion, and reports microphone/transcription failures inline.

## Preserved behavior and exclusions

The extension preserves the established agent network request, NDJSON progress handling, local conversation storage/migration, abort/stop behavior, voice recording and transcription paths, structured result blocks, actions, and agent refreshes. This document does not authorize changing those behaviors.

It also excludes changes to the root `DESIGN.md`, public landing-page direction, shared AutoYT component rules, third-party branding, or global typography. Any future cross-product design decision belongs in the existing design-system documentation, not here.

## Validation status

| Check | Status | Evidence / result |
| --- | --- | --- |
| Direction contract trace | Pass | The implemented rail, unboxed assistant prose, neutral user bubble, 22px composer, dock fade, light/dark handling, mobile drawer, progress, and accessible controls match `docs/research/claude-ai-5502a6be/new-c84eba96/spec.md`. |
| Desktop visual review | Pass | Reviewed `.impeccable/review/desktop.png` (1440×900): flat history rail, focused reading column, response actions, quick actions, and single elevated composer are present. |
| Mobile visual review | Pass | Reviewed `.impeccable/review/mobile.png` (390×844): readable message rhythm, stacked/wrapped actions, horizontal quick actions, and bottom composer remain usable. |
| Mobile history review | Pass | Reviewed `.impeccable/review/mobile-history.png` (390×844): history is an overlay drawer with an opaque rail, dismiss scrim, and close affordance. |
| TypeScript check | Pass | `npm run lint` completed successfully (`tsc --noEmit`). |
| Production build | Pass with existing bundle-size warning | `npm run build` completed successfully; Vite reports a minified JavaScript chunk above 500kB, but the build exits successfully. |
| Impeccable mechanical detector | Reviewed — warnings retained | The detector reports two warnings in `src/index.css`: the incumbent Inter font import and `transition: height` on the voice-wave bar. This documentation-only pass makes no code changes, so neither warning was altered. |
| Live interaction exercise | Not run in this documentation pass | Keyboard, voice permission, streaming, retry, and stop behavior were traced in source rather than replayed in a browser session. |
