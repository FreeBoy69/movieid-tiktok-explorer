// Logged-out tool pages. Each studio gets its own lines so a search or
// answer engine can quote that page, not a shared homepage blurb.
export type ToolPageCopy = { headline: string; body: string; points: string[] };

export const TOOL_PAGE_COPY: Record<string, ToolPageCopy> = {
  image: {
    headline: "Describe a still. Get the image.",
    body: "Image Studio turns a written description into a picture, or starts from an image you already have. Reference frames stay with the prompt, so the next version follows the same idea.",
    points: ["Text to image from a plain description", "Image to image when you already have a frame", "Edits that keep the references you attach"],
  },
  "background-remover": {
    headline: "The subject on white, or the scene without it.",
    body: "Background Remover cuts the main subject out of a photo onto clean white, or does the opposite and erases the subject so only the scene remains. One upload, one pass.",
    points: ["Clean edges on a plain white background", "Keep the scene and remove the person instead", "Results you can send on to Video Studio or Lip Sync"],
  },
  "layer-splitter": {
    headline: "One photo, two layers.",
    body: "Layer Splitter returns the cut-out subject and the clean background as separate images, so a still can become a parallax shot, a composite, or a thumbnail with depth.",
    points: ["Subject and background as two files", "Both layers from a single upload", "Made for compositing and motion"],
  },
  "image-upscaler": {
    headline: "The same image, at the model's highest resolution.",
    body: "Image Upscaler re-renders a small or soft picture with crisp detail and leaves composition, colors, and content unchanged.",
    points: ["Highest resolution the model offers", "Nothing moves, nothing is redrawn", "Ready for print, covers, and large frames"],
  },
  "image-expander": {
    headline: "More canvas around the picture you have.",
    body: "Image Expander outpaints beyond the edges to a new aspect ratio, continuing the scene with matching light and perspective while the original stays untouched.",
    points: ["Pick the new aspect ratio", "The scene continues past the old frame", "A portrait becomes a landscape without a crop"],
  },
  relight: {
    headline: "Change the light. Keep the shot.",
    body: "Relight takes a description of the lighting you want and applies it to the photo without moving the subject or the camera.",
    points: ["Golden hour, studio key, neon, overcast", "Subject and composition stay identical", "A sentence instead of a lighting rig"],
  },
  restyle: {
    headline: "The same composition, redrawn in a new style.",
    body: "Restyle keeps every subject where it is and renders the picture as a painting, an animation frame, a print, or any style you name.",
    points: ["Any style you can describe", "Composition and subjects preserved", "One image in, one restyled image out"],
  },
  "object-remover": {
    headline: "Erase what shouldn't be there.",
    body: "Object Remover deletes text, logos, people, or clutter you name and fills the gap so it matches the surroundings. Nothing else changes.",
    points: ["Watermarks and signage gone", "Natural fill that matches the scene", "Name the object, no masking"],
  },
  "magic-edit": {
    headline: "Edit a photo with a sentence.",
    body: "Magic Edit applies exactly the change you describe to one image: a color, a prop, the weather, the time of day. The rest of the picture is left alone.",
    points: ["Precise edits from plain language", "Only the described part changes", "Results flow on to other tools"],
  },
  "thumbnail-maker": {
    headline: "Thumbnails built to be tapped.",
    body: "Thumbnail Maker renders a 16:9 image from a style, your on-image title, and a description, with an optional photo of you or the product in the frame.",
    points: ["Six thumbnail styles", "Your title text rendered on the image", "Your face or product as the focal point"],
  },
  "video-upscaler": {
    headline: "Sharper footage, same cut.",
    body: "Video Upscaler re-renders a clip at 1.5×, 2×, or 3× its resolution with recovered detail and no change to timing or framing.",
    points: ["MP4, MOV, or WebM in", "Choose the scale", "Timing and framing untouched"],
  },
  transcriber: {
    headline: "A link becomes a transcript.",
    body: "Video Transcriber turns a YouTube, TikTok, or direct video link into the full text, a subtitle file, and a hand-off into the rewriter or text to speech.",
    points: ["Full transcript from a link", "Subtitles as an .srt file", "Rewrite or read it aloud in one click"],
  },
  "audio-extractor": {
    headline: "Just the sound.",
    body: "Audio Extractor saves the soundtrack of a video you have the right to keep, at the quality you pick, without the picture.",
    points: ["A link as the source", "Audio quality you choose", "Music, narration, or interviews on their own"],
  },
  "vocal-remover": {
    headline: "The voice on one track, the music on another.",
    body: "Vocal Remover splits a video's sound in two: the narration or dialogue alone, and the music and effects with the voice taken out. Use it to re-voice a clip or keep only the score.",
    points: ["A video or its link as the source", "Two MP3s: voice only, and everything else", "Ready for a new voiceover or a remix"],
  },
  "thumbnail-downloader": {
    headline: "The cover image, full size.",
    body: "Thumbnail Downloader fetches the largest cover image a video link offers and saves it as a file, for study, references, or a remake.",
    points: ["YouTube, TikTok, and most video sites", "Full resolution, not the preview", "Saved as a file, not opened in a tab"],
  },
  "poster-finder": {
    headline: "Posters and facts for any title.",
    body: "Poster Finder looks up a film or series and returns the poster and backdrop at full size, the synopsis, runtime, rating, director, and top cast.",
    points: ["Search by title, narrow by year", "Poster and backdrop at full size", "Cast, crew, and links to TMDB and IMDb"],
  },
  "title-generator": {
    headline: "Titles people click, honest to the video.",
    body: "Title Generator writes a set of specific titles under 60 characters from a topic or transcript, each with a different angle, and sends any of them to the Thumbnail Maker.",
    points: ["Up to twenty titles per run", "Curiosity, list, how-to, or bold styles", "One click into a thumbnail"],
  },
  "description-writer": {
    headline: "The description, tags, and chapters, done.",
    body: "Description Writer drafts a platform-ready description with the hook and keyword up top, your links, search tags, hashtags, and chapters when the notes have timestamps.",
    points: ["YouTube, Shorts, TikTok, or Instagram length", "Your links kept exactly as given", "Tags, hashtags, and chapters alongside"],
  },
  "hashtag-generator": {
    headline: "Hashtags sized for reach.",
    body: "Hashtag Generator mixes broad, medium, and niche tags for a post so it can rank in small pools and still ride the large ones. Tick the ones you want and copy.",
    points: ["A balanced mix of reach sizes", "Tuned to the platform", "Copy exactly the set you choose"],
  },
  "editable-design": {
    headline: "A poster that stays editable after it is made.",
    body: "Editable Design plans a fixed-canvas poster, paints its artwork, and writes the layout as one HTML file with real text and independent layers. Drag, resize, and retype anything in the built-in editor, then export the PNG.",
    points: ["Live text, never baked into an image", "Every element a movable, resizable layer", "A layer breakdown and PNG export"],
  },
  cinema: {
    headline: "Set the camera before you describe the shot.",
    body: "Cinema Studio asks for the body, lens, focal length, and aperture, then the scene. The controls sit in front of the prompt so the shot is directed, not only described.",
    points: ["Camera body and lens as part of the setup", "Focal length and aperture on the same shot", "A scene description after the rig is chosen"],
  },
  "ai-influencer": {
    headline: "One face, carried from scene to scene.",
    body: "AI Influencer keeps a single person consistent while the setting changes. Build the face once, then place that person in the next shot without redesigning them.",
    points: ["A fixed face across scenes", "New settings around the same person", "Stills you can carry into a video studio"],
  },
  create: {
    headline: "A title goes in. A narrated video comes out.",
    body: "Create Video writes the script from the idea, voices it, storyboards the scenes, and renders the cut. The piece stays in one workspace from the first line to the finished file.",
    points: ["A script written from the title or brief", "A voice read over the scenes", "A rendered cut you can return to when signed in"],
  },
  drama: {
    headline: "A short series, one episode at a time.",
    body: "Create Drama is for a story that continues. Start with the series idea, then build episodes in order so the characters and the plot stay in the same project.",
    points: ["A series idea as the starting point", "Episodes made in sequence", "The same story kept together in one project"],
  },
  compile: {
    headline: "Many clips, assembled into one long video.",
    body: "Compilations builds a longer video out of clips you choose. It is the studio for a cut that is made of pieces, not a single generated shot.",
    points: ["Several clips in one timeline", "A long-form cut from those pieces", "Selection that stays in the compilation project"],
  },
  video: {
    headline: "A prompt or a still, then the moving shot.",
    body: "Video Studio makes a clip from text or from an image you already have, and it can upscale a video that needs a larger frame. The shot starts where your source starts.",
    points: ["Text to video from a description", "Image to video when the first frame exists", "Upscaling for a clip that needs more resolution"],
  },
  marketing: {
    headline: "A product photo becomes the ad.",
    body: "Marketing Studio starts from the product itself. Add the photo, describe the spot, and the studio builds an ad around that object instead of a generic scene.",
    points: ["The product photo as the source", "An ad built around that object", "A spot you can revise from the same setup"],
  },
  promo: {
    headline: "A launch film in motion graphics.",
    body: "Promo Studio makes launch videos with motion-graphics scenes. Use it when the piece is a title sequence, a product reveal, or a short film of type and image in motion.",
    points: ["Motion-graphics scenes rather than a live-action look", "Launch and reveal structures", "Type and image moving in the same film"],
  },
  explainer: {
    headline: "A walkthrough of your product, in your voice.",
    body: "Explainer Studio reads your website and screenshots, drafts a chaptered walkthrough script you can edit, and narrates it in a voice you clone or a built-in one. Each chapter shows the real screens, timed to what the narrator is saying.",
    points: ["A script drafted from your own site and screens", "Narration in your cloned voice or a built-in one", "Real screens with cursor, zoom, and captions on the narration's timing"],
  },
  clipping: {
    headline: "A long video, cut into shorts.",
    body: "AI Clipping takes a longer video and pulls out pieces meant to post on their own. The source stays intact while the shorts are chosen from it.",
    points: ["A long video as the source", "Shorts pulled out for posting", "The original left in place while the clips are made"],
  },
  "motion-control": {
    headline: "The character follows a move you already have.",
    body: "Motion Control copies a reference movement onto a character. Bring the move, then apply it so the performance follows that motion instead of inventing a new one.",
    points: ["A reference move as the source", "A character that follows that motion", "Performance driven by the clip you provide"],
  },
  "vibe-motion": {
    headline: "Titles and graphics that move from a prompt.",
    body: "Vibe Motion is for motion graphics and titles described in words. Ask for the feeling and the line, and the studio builds the moving graphic around them.",
    points: ["Titles and graphics from a prompt", "Motion described in plain language", "A graphic piece rather than a filmed scene"],
  },
  lipsync: {
    headline: "A portrait speaks the audio you give it.",
    body: "Lip Sync takes a front-facing portrait and a voice track and moves the mouth to that audio. The face and the recording stay yours. The studio matches them.",
    points: ["A portrait as the face", "An audio track as the line", "Mouth movement matched to that recording"],
  },
  "body-swap": {
    headline: "Replace the person. Keep the shot.",
    body: "Body Swap puts a different person into a video that already exists. The camera move and the scene stay. The person in frame is the one you choose.",
    points: ["An existing video as the shot", "A different person placed in frame", "The scene and camera left in place"],
  },
  tts: {
    headline: "Type the line. Hear it in a studio voice.",
    body: "Text to Speech reads what you write. Use a studio voice or one you have cloned, then take the audio into a video, a portrait, or a mix.",
    points: ["A script typed in as the source", "Studio voices and cloned voices", "Audio you can carry into another studio"],
  },
  audio: {
    headline: "A music cue from a sentence.",
    body: "Audio Studio writes an original music cue from a description of the mood, the tempo, and the use. The track is made for the video, not pulled from a library.",
    points: ["A prompt for mood and use", "An original cue rather than a catalog track", "Music you can place under a cut"],
  },
  discover: {
    headline: "See who is already publishing in a niche.",
    body: "Niche Finder looks through channels and outliers in a topic before you make the video. Search the niche, then read who is there and what is breaking out.",
    points: ["A niche searched in plain language", "Channels already publishing in it", "Outliers worth a closer look"],
  },
  youtube: {
    headline: "Scan a niche before you commit to it.",
    body: "YouTube Radar scans niches and the channels coming up inside them. Use it to see the field, not to guess it from a single video.",
    points: ["A niche or topic as the search", "Emerging channels in that field", "A scan you can follow into a video idea"],
  },
  tiktok: {
    headline: "Read a TikTok, or a creator, before you remake it.",
    body: "TikTok Explorer analyzes a video or a collection. Paste a link or search a creator and review the piece instead of downloading it and guessing.",
    points: ["A link or a creator search", "Analysis of the video or the set", "A read you can take into a script"],
  },
  niches: {
    headline: "A map of the markets, not a single search.",
    body: "Niche Library is the taxonomy of content markets in AutoYT. Browse the categories when you want the landscape, not one channel.",
    points: ["Markets organized as a library", "Categories you can open and compare", "A map to use before Niche Finder or Radar"],
  },
  movie: {
    headline: "Name the film from the clip.",
    body: "Movie ID identifies a film from a video you provide. Bring the clip. The studio matches it and lays out the title, the transcript, and the evidence it used.",
    points: ["A clip as the only input required", "A title match with the evidence beside it", "Transcript and story notes from the same pass"],
  },
  downloader: {
    headline: "Take the video, or just the audio.",
    body: "Video Downloader saves a video you have the right to keep, as picture or as audio, in the quality you pick. Paste the link and choose the file.",
    points: ["A link as the source", "Video or audio as the file", "A quality choice before the download"],
  },
  rewriter: {
    headline: "A transcript becomes a script you can shoot.",
    body: "AI Rewriter takes a transcript or an existing script and drafts an original version. The source stays the reference. The draft is what you edit next.",
    points: ["A transcript or script pasted in", "An original draft from that source", "A script you can take into Create Video"],
  },
  prompts: {
    headline: "Prompts kept for the next time you need them.",
    body: "Prompt Library holds prompts that already work, sorted by the job. Open one, then carry it into the studio that will use it.",
    points: ["Prompts grouped by the work they do", "A line you can reuse instead of rewriting", "A handoff into the studio that needs it"],
  },
  styles: {
    headline: "A look you can reuse on the next video.",
    body: "Styles stores a channel look or an art direction so the next piece starts from the same rules. Set it once, then apply it instead of describing it again.",
    points: ["A saved look for a channel or a series", "Art direction that carries to the next piece", "Less re-describing of the same style"],
  },
  projects: {
    headline: "Every video you have made, in one list.",
    body: "Projects is the shelf for finished and in-progress videos on your account. Sign in to see the pieces you have already started and open one again.",
    points: ["Videos tied to your account", "In-progress work beside finished cuts", "A way back into a piece you already started"],
  },
  automation: {
    headline: "Agents that keep a channel running.",
    body: "Automation is where agents find sources, make the clips, and publish on a schedule you set. The channel work is described once, then the agent repeats it.",
    points: ["A schedule instead of a one-off export", "Sources, clips, and publishing in one agent", "A channel workflow you can leave running"],
  },
  agents: {
    headline: "An agent that plans the piece, then makes it.",
    body: "Creative Agents take a brief and plan the media before they produce it. Use one when the job is a sequence of steps, not a single prompt.",
    points: ["A brief instead of a single prompt box", "A plan before the generation", "Media produced from that plan"],
  },
  "design-agent": {
    headline: "Posters, graphics, and logos by conversation.",
    body: "Design Agent makes graphic work through chat. Describe the poster, the graphic, or the logo, then refine it in the same thread.",
    points: ["A chat instead of a blank canvas", "Posters, graphics, and logos", "Revisions in the same conversation"],
  },
  workflows: {
    headline: "Several studios, one pipeline.",
    body: "Workflows chains steps across studios so a job that needs a script, a voice, and a shot can run as one pipeline instead of three separate visits.",
    points: ["More than one studio in a single job", "Steps that follow each other", "A pipeline you can run again"],
  },
  "vibe-edit": {
    headline: "Edit a video by saying what you want.",
    body: "Vibe Edit is a multi-track editor with an assistant beside it. Drop in clips, then ask for captions, a voiceover in any of 30 voices, music under the voice, titles, or a tighter cut, and watch the timeline change.",
    points: ["Word-timed captions from your audio", "Voiceovers with a delivery direction and language", "Export a finished MP4 from the browser"],
  },
  "digital-products": {
    headline: "Turn an idea into a book you can ship.",
    body: "Digital Product Maker develops an editable ebook or workbook manuscript, creates custom cover artwork, and lets you preview the reader experience before export.",
    points: ["Draft a book from your own brief", "Generate a vertical cover illustration", "Edit chapters, preview, and export as Markdown"],
  },
  channels: {
    headline: "Prepare a video, then publish it to the channel.",
    body: "Channel Management is where a connected YouTube channel is optimized and where a video is prepared for publishing. Connect the channel, then work from that account.",
    points: ["A connected YouTube channel", "Optimization before you publish", "Publishing prepared from the same place"],
  },
  feed: {
    headline: "New uploads from the channels you follow.",
    body: "Feed lists new videos from channels you follow inside AutoYT. It is the inbox for what those channels just posted, not a second homepage.",
    points: ["Channels you have chosen to follow", "New videos as they show up", "A list meant for research, not for browsing at random"],
  },
};

export function toolPageCopy(id: string): ToolPageCopy | null {
  return TOOL_PAGE_COPY[id] ?? null;
}
