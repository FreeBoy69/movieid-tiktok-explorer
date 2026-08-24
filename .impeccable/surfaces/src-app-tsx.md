---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/components/ToolsHub.tsx","src/components/AutomationAgents.tsx","src/components/BackgroundProcessCenter.tsx","src/index.css"]
---

# AutoYT Studio Workspace

## Scope and mode

- **Mode:** Operate.
- **Scope:** The signed-in workspace shell rooted at `src/App.tsx`, including the unified studio rail, Tools index, and Automation chat. This is an established-product extension; the global identity remains owned by `DESIGN.md`.
- **Audience:** Creators and small content teams moving repeatedly between research, production utilities, channel operations, and agent conversations.
- **Job:** Make the next tool or conversation immediately reachable while preserving one stable sense of place.

## Tasks, content, and proof

- The primary navigation order is Tools, TikTok Explorer, Feed, Channel Management, Compilations, and Automation.
- Tools exposes exactly five focused utilities: Movie ID, YouTube Radar, Niche Library, AI Rewriter, and Text to Speech. Each card explains the utility and opens its workspace directly; there are no tags or secondary taxonomy controls.
- Automation exposes Chats inside the same app rail. Conversation search, selection, creation, and deletion coexist with the workspace navigation rather than creating a nested application sidebar.
- Chat content proves usefulness through readable agent responses, inline progress, structured results when needed, and follow-up actions immediately beneath the assistant message.

## Chosen direction

**One quiet studio frame.** Desktop uses a single 248px rail. Workspace navigation occupies its upper section; when an Automation agent is open, the chat list is portaled below it. Active navigation and active conversations use a thin yellow leading marker, never a boxed selected state.

The surface inherits the AutoYT paper, charcoal, and yellow palette and Inter workhorse typography from `DESIGN.md`. Materials are solid, separated by 1px borders and soft offset shadows. Gradients and glass treatments do not belong on this surface. Utility labels stay compact at 12px with 14px navigation icons.

The Tools index presents five exact 9:16 cards in two columns on mobile and five columns on wide desktop. Each card is an editorial tool poster: its upper stage is full-bleed solid artwork with distinct Movie, Radar, Library, Rewriter, and Voice geometry. These stages use only warm paper, charcoal, and yellow, never gradients or tags. A quiet lower copy area holds the tool name, concise description, and arrow action.

Chat keeps a 65–75ch reading canvas, restrained neutral user bubbles, open assistant prose, and response actions below each assistant message. The composer remains 640–672px wide, uses shadow as its active cue, and keeps the same border on click/focus; keyboard focus is expressed on the controls inside it. Voice waveform motion changes `transform: scaleY(...)`, not layout height.

On mobile, navigation becomes a drawer and Chats opens as its own temporary sheet only when requested. Background Activity belongs in the workspace header or Agent tools; it must never float over cards, conversation content, or the composer.

**Memorable moment:** entering an agent conversation changes the lower half of the familiar studio rail into Chats while the main canvas opens into a calm, readable operating dialogue—one workspace, not an app nested inside another app.

## Constraints

- Never render workspace navigation and chat history as adjacent or nested permanent sidebars.
- Keep the exact five-card Tools set and its 9:16 geometry unless product scope is intentionally expanded.
- Do not add tags, gradient fills, glass blur, or a boxed active-navigation treatment.
- Keep the composer border visually stable during pointer interaction and focus; use shadow and focus-visible control outlines for state.
- Preserve the compact label/icon scale and the established global typography, including Inter for functional UI.
- Keep mobile Activity access out of the content plane.

## Shipped validation

- `tools-redesign-desktop.png` validates the five-poster desktop composition; `tools-redesign-mobile.png` validates the two-column 390×844 mobile composition.
- The rendered cards hold the exact 0.5625 aspect ratio at both breakpoints, with no clipping and no console errors.
- `chat-desktop.png` and `chat-mobile.png` continue to validate the previously shipped chat composition. The final Activity integration was validated in code after moving it from the content plane into the mobile workspace header and Agent tools.
- Independent finish review disposition after the focus-contrast fix: **SHIP**.

## Unresolved decisions

None for the shipped scope. Any sixth tool, alternate rail taxonomy, or persistent mobile utility requires a new surface-level decision rather than an incidental component addition.
