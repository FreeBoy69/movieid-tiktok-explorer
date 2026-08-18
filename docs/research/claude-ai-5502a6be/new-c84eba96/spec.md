# AutoYT chat upgrade specification

## Direction contract

**THESIS:** Make the agent feel like a focused operating partner, not a dashboard widget; refuse a screen made from equally loud boxes.

**OWN-WORLD:** Warm AutoYT paper, quiet charcoal type, one yellow signal, open assistant prose, soft neutral user bubbles, and a single elevated composer.

**STORY:** The creator sees what the agent can do, asks naturally, follows progress, reads an answer comfortably, and can act on structured results without leaving the conversation.

**FIRST VIEWPORT:** A quiet history rail sits left; the center holds an editorial question, one large composer, and compact capability prompts. The composer is the only pronounced elevated surface.

**FORM:** Claude-inspired conversational workspace adapted inside AutoYT's established product identity. Reference key `claude-ai-5502a6be/new-c84eba96`.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Component topology

- `AgentChatWorkspace`: desktop rail/drawer state and active conversation selection.
- `AgentChatHistorySidebar`: flat history navigation, search, new, collapse, delete.
- `AgentChatPanel`: empty state, message stream, composer dock, errors, scroll recovery.
- `AgentThinkingStatus`: streaming progress inside the message rhythm.
- `FormattedChatText`: readable assistant prose.
- `AgentChatBlocks`, `AgentChatCards`, `AgentChatRichHtml`: structured AutoYT results beneath assistant prose.

## Required implementation

1. Flatten the history rail and replace the full-box current-row treatment with a left accent and soft tint.
2. Give the empty state a clearer hierarchy: editorial question, one-line scope, composer, and compact prompt controls.
3. Refine composer geometry to a 20–24px shell, circular action buttons, clearer focus-visible feedback, and a contextual footer that does not compete with the textarea.
4. Keep assistant messages unboxed. Add a small identity/meta line and a quiet response action row beneath the prose.
5. Keep user messages compact and neutral with no pronounced shadow.
6. Add a paper-to-transparent dock fade so the active composer feels anchored without a footer bar.
7. Preserve all existing network, speech, storage, streaming, and action behavior.
8. Cover light/dark themes and 390px mobile behavior.

## Acceptance checks

- Empty, populated, busy, error, collapsed-history, and mobile-history states remain usable.
- Enter sends; Shift+Enter inserts a line break; stop aborts; voice input still works where supported.
- All icon controls have accessible names and visible keyboard focus.
- No Claude logos, names, copy, colors, or downloaded screenshots ship in the UI.
- Production build and TypeScript checks pass.
