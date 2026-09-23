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

**One header, dark-first (2026-09-23 redesign, replaces the 248px rail).** The sidebar is gone. A 56px sticky header (`src/components/AppHeader.tsx`) carries the logo, Explore, and grouped mega menus (Image, Video, Audio, Research, Tools, Agents, Channels) modeled on Higgsfield: hover or keyboard opens columns of icon-tile rows with one-line descriptions. Search (⌘K), background activity (with a running count), theme, and account sit on the right. The information architecture is one list in `src/utils/appNavigation.tsx`.

Dark is the default theme; AutoYT yellow is the only accent and marks the current section. The universal `.app-backdrop` (grid + yellow glow) shows behind every page. The Explore page (`ToolsHub`) keeps the 9:16 tool posters and adds an "Everything in AutoYT" directory grouped like the header.

Automation chats get a 280px panel beside the conversation when an agent is open; they never become a second navigation rail. Creator Studio's own in-page header was merged into the global header. Its generic apps use a Higgsfield-style left control panel + results stage, except Image, Video, and Audio Studio (composer bar) and Marketing and Cinema Studio (bespoke pages).

**Memorable moment:** hovering Video opens a two-column menu where the page you're on glows yellow, so switching from Lip Sync to Motion Control is one move without losing your place.

## Constraints

- Never reintroduce a persistent left navigation rail.
- Background activity lives only in the header; nothing floats over page content.
- Keep the uppercase Inter 800 studio titles and the `.app-backdrop` universal background.
- New destinations are added to `appNavigation.tsx` so the header, phone menu, search, and Explore stay in sync.

## Shipped validation

- Desktop 1440/1512 and phone 390 screenshots in dark and light: header menus, quick search, Explore directory, Creator Studio panel apps (empty, history, open model menu), Image Studio's unchanged composer, Movie ID, Create Video, Text to Speech, Automation, Channels.

## Unresolved decisions

- 2026-09-23: the user added a **Prompt Library** tool (Tools card with a fanned prompt-card poster, route `/prompts`). It is a list plus reading pane (bottom sheet on phones) over curated prompts.chat data; the same data feeds inline Suggestions chips in Create Video fields.
- 2026-09-23: the user added **Creator Studio** to the rail (after Create Video). It opens a full-height page whose header carries the Open Generative AI category menus (Images, Video, Audio, Agents & Automation, Explore Apps); agent chat history lives in a header menu there, never a second sidebar.

None for the shipped scope. Any sixth tool, alternate rail taxonomy, or persistent mobile utility requires a new surface-level decision rather than an incidental component addition.
