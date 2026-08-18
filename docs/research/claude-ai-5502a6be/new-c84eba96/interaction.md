# Interaction sweep

| State | Reference behavior | AutoYT behavior to keep or improve |
| --- | --- | --- |
| Empty chat | Centered personalized question and dominant composer, with no competing card grid | Keep centered start state; add only a concise capability line and quiet prompt controls |
| Composer focus | Composer becomes the strongest elevated object | Use a subtle neutral focus border/shadow, a muted keyboard outline, and a clear send affordance |
| Multi-line input | Textarea grows inside a fixed composer shell | Keep current auto-grow up to 200px and keyboard submission behavior |
| Assistant response | Long-form content is unboxed and readable; actions/date sit in a quiet response toolbar | Keep structured blocks below prose; add a quiet response header and move copy into a footer toolbar |
| User response | Compact neutral bubble aligned right | Keep right alignment; remove strong border and reduce visual weight |
| Thinking | Lightweight status near the conversation flow | Preserve streamed progress; render as a calm inline status with AutoYT mark |
| History | Flat rail, low-contrast rows, current item indicated without a loud card | Replace full yellow row highlight with a slim yellow rail and tint; retain search/delete/new chat |
| Composer dock | Composer stays reachable at the end of an active conversation | Add a soft paper fade behind the dock and preserve quick actions above it |
| Scroll recovery | Small floating return-to-latest control | Preserve behavior; align its elevation and focus treatment with composer controls |
| Mobile history | Off-canvas drawer with scrim | Keep existing drawer; improve width, tap targets, and close behavior |
| Error | Inline, recoverable, non-destructive | Keep retry/dismiss controls and strengthen focus-visible states |
| Busy cancel | Explicit stop action replaces send | Preserve stop control and maintain input content on abort |

## Responsive rules

- Desktop: 280px history rail, fluid chat canvas, conversation measure around 720–760px.
- Tablet: history becomes a drawer; chat content retains the centered measure.
- Mobile: 16px edge padding, composer nearly full width, horizontally scrollable quick actions, user bubble max 90%, and no decorative element may reduce tap targets below 44px.
