# Claude chat reference — global extraction

- Target: `https://claude.ai/new`
- Site key: `claude-ai-5502a6be`
- Page key: `new-c84eba96`
- Destination: AutoYT agent chat at `/automation/:slug`, rendered by `AgentChatWorkspace` and `AgentChatPanel`.
- The workspace was initially gated; after the user authenticated, the live empty-chat and populated-conversation structures were inspected directly at desktop and mobile sizes.

## Sources

- Live public shell: `https://claude.ai/new`
- Projects announcement: `https://www.anthropic.com/news/projects`
- Reflection announcement: `https://www.anthropic.com/news/reflect-with-claude`
- Official reference images are stored in `docs/design-references/claude-ai-5502a6be/new-c84eba96/`.
- Authenticated empty-chat captures: `claude-authenticated-desktop.png` and `claude-authenticated-mobile.png`.

## Visual grammar to adapt

- Warm off-white workspace with a quiet, slightly tinted navigation rail.
- A narrow, text-first conversation column with generous vertical rhythm.
- Assistant replies read as page content, not as chat bubbles.
- User prompts use a restrained neutral bubble to keep authorship legible.
- The composer is the primary piece of elevation: a large white surface, soft shadow, roomy textarea, and a secondary control row.
- On the current empty state the composer sits immediately below a personalized serif question; it spans roughly 640px on desktop and nearly the full viewport on mobile.
- The desktop sidebar is flat and persistent, while mobile collapses it to a single top-left control.
- Conversation messages use semantic feed/article structure, hidden descriptive headings, and a compact actions toolbar with a date beneath the active response.
- Controls are compact and familiar. Important actions gain contrast; secondary actions remain icon-led and low-noise.
- Serif display type is used selectively for conversational emphasis, while functional labels remain sans-serif.
- Detail panels and structured outputs may use bordered surfaces, but the chat canvas itself stays open.

## AutoYT translation

- Preserve AutoYT yellow `#f9dc0b`, warm paper `#F9F8F6`, charcoal `#1A1A1A`, Playfair Display, Inter, and JetBrains Mono.
- Preserve voice input, streaming progress, agent actions, quick prompts, conversation history, copy, retry, and internal structured content.
- Use AutoYT's sparkle mark instead of Claude or Anthropic marks.
- Do not ship any downloaded Claude imagery or brand assets; the images are visual research only.
