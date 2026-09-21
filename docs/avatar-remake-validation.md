# Avatar remake validation

Validated September 21, 2026 using the first 12 seconds of the supplied Matt Wolfe reference and the user-supplied face photo. No face photo, reference media, credentials, or generated client video is included in the repository.

## Behavior

- Smart layout detects visual cuts and classifies each scene as presenter, split-screen, or cutaway. Split panels include their side and seam coordinate.
- Only the presenter region is replaced. Screen recordings and cutaways retain their original framing and timing.
- Unknown scene layouts, reordered timelines, short generated avatars, and mismatched source/narration duration stop the render instead of silently exporting broken media.
- Portraits fit inside the replacement region over a soft background derived from the same avatar, avoiding crops through the face.
- Output audio comes from the selected narration, not the original source or a second provider-generated track.
- OpenRouter requires an HTTPS audio reference. Provider narration links use a 256-bit random capability, expire after two hours, and are not returned as public exports. Expired files are removed on the next provider-media publication.
- Local VPS Whisper remains first choice; chat falls back to OpenRouter transcription only on local failure.

## Evidence

- VPS local Whisper: success, 35 timestamped segments for the 81-second reference. Technical names still require proofreading.
- OpenRouter / HeyGen Avatar IV: successful image-plus-audio render using the supplied photo. Generated video: 720x1280, 25 fps, 11.97 seconds for 12 seconds of supplied narration.
- Automatic scene analysis: all seven opening scenes classified. Split, cutaway, and full-presenter transitions agreed with frame inspection. The model needed an 8192-token budget; 1600 truncated its response.
- Final client test: 720x1280, 30 fps, 360 frames, 12.000 seconds, H.264 and AAC. The compositor holds the final avatar frame for the sub-frame provider shortfall.
- `node scripts/test-avatar-composition.mjs`: real FFmpeg pixel comparisons in 9:16 and 16:9. Mean retained-region error below 0.34 on an 8-bit channel scale; replaced-region differences above 128. Both outputs have exactly 180 frames / 6 seconds. Frequency checks verify replacement narration rather than source audio.
- `scripts/test-voiceover-timeline-ui.mjs`: desktop, tablet, mobile, and dark-mode checks, including Smart selection, scene editing, seeking, and overflow.
- TypeScript check and full Vitest suite: 53 files, 262 tests passed.

## Limits

The live provider test covers 12 seconds, not the complete 81-second reference. It uses the original reference narration to isolate avatar replacement; it is not a test of rewritten text or a cloned client voice. Lip movement was inspected in extracted frames, not scored with an audiovisual lip-sync model. Perfect likeness or synchronization is not guaranteed.

Burned-in text outside the replaced panel remains source content. Existing caption replacement tools can be applied separately. Scene detection samples one frame per visual cut and can miss gradual layout changes; review detected scenes and the export before publishing. Smart rendering does not support reordered video against unchanged narration. OpenRouter renders over 180 seconds are explicitly rejected instead of silently truncated.
