// Logged-out tool pages. Each studio gets its own lines so a search or
// answer engine can quote that page, not a shared homepage blurb.
export type ToolPageCopy = { headline: string; body: string; points: string[] };

export const TOOL_PAGE_COPY: Record<string, ToolPageCopy> = {
  image: {
    headline: "Describe a still. Get the image.",
    body: "Image Studio turns a written description into a picture, or starts from an image you already have. Reference frames stay with the prompt, so the next version follows the same idea.",
    points: ["Text to image from a plain description", "Image to image when you already have a frame", "Edits that keep the references you attach"],
  },
  layers: {
    headline: "Finish the still after the first generation.",
    body: "Layers Studio is for the work that happens after an image exists. Cut a subject out, expand the frame, raise the resolution, or change the light without starting over.",
    points: ["Cutouts that leave the subject clean", "Expand the canvas past the original frame", "Upscale and relight the same picture"],
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
  voiceover: {
    headline: "Rewrite the words, replace the voice, mix the cut.",
    body: "Voiceover Studio works on a video you already have. Rewrite the narration, record a new read, and mix it back onto the picture.",
    points: ["An existing video as the start", "A rewritten narration", "A new voice mixed onto the cut"],
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
