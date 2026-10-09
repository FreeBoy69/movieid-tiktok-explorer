import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, LockKeyhole, Sparkles, Upload, X } from "lucide-react";
import { navEntryFor } from "../utils/appNavigation";
import type { MainView, StudioTab, ToolId } from "../utils/tiktokRoute";
import { SiteFooter } from "./SiteFooter";
import { toolPageCopy } from "./guestToolCopy";
import { AuthCancelled, signInWithApple } from "../native/auth";
import { nativePlatform } from "../native/platform";
import { messageOf } from "../utils/toast";
import "./GuestToolView.css";

type Theme = "light" | "dark";


const PROMPTS: Record<string, string> = {
  image: "Describe the image you want to make...",
  "editable-design": "Describe the poster, flyer, or cover...",
  video: "Describe your video...",
  cinema: "Describe the scene you want to shoot...",
  create: "What is your video about?",
  drama: "Describe your series idea...",
  tts: "Type the words you want to hear...",
  audio: "Describe the music you want to make...",
  discover: "Search a niche...",
  youtube: "Search a topic or channel...",
  automation: "Describe the channel you want an agent to run...",
  tiktok: "Paste a TikTok link or search a creator...",
  downloader: "Paste a video link...",
  rewriter: "Paste a transcript or script...",
  movie: "Paste a video link...",
  "background-remover": "Upload the image to cut out...",
  "layer-splitter": "Upload the image to split...",
  "image-upscaler": "Upload the image to upscale...",
  "image-expander": "Upload the image to expand...",
  relight: "Describe the new lighting...",
  restyle: "Describe the new style...",
  "object-remover": "What should disappear?",
  "magic-edit": "Describe the edit...",
  "thumbnail-maker": "Describe the thumbnail and its title...",
  "video-upscaler": "Upload the clip to upscale...",
  transcriber: "Paste a video link...",
  "audio-extractor": "Paste a video link...",
  "thumbnail-downloader": "Paste a video link...",
  "poster-finder": "Type a film or series title...",
  "title-generator": "What is the video about?",
  "description-writer": "Paste the title and your script...",
  "hashtag-generator": "Describe the post...",
};

export function GuestToolView({ view, studioTab, toolId, theme, onBack, onUse }: { view: MainView; studioTab?: StudioTab; toolId?: ToolId; theme: Theme; onBack: () => void; onUse: () => void }) {
  const entry = navEntryFor(view, studioTab, toolId);
  if (!entry) return null;
  const prompt = PROMPTS[entry.id] ?? `Start with ${entry.label}...`;
  const page = toolPageCopy(entry.id);
  const structured = page ? {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${entry.label} — AutoYT`,
    description: page.body,
  } : null;
  return (
    <section className="gv" data-theme={theme} aria-labelledby="gv-title">
      {structured ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured) }} /> : null}
      <div className="gv-top">
        <button type="button" className="gv-back" onClick={onBack}><ArrowLeft size={17} /> Explore</button>
        <span className="gv-private"><LockKeyhole size={13} /> Your workspace</span>
      </div>
      <div className="gv-main">
        <div className="gv-copy">
          <span className="gv-eyebrow">{entry.icon} AutoYT Studio</span>
          <h1 id="gv-title">{entry.label}</h1>
          <p>{entry.description}.</p>
          <div className="gv-compose">
            <label htmlFor="gv-prompt">Start creating</label>
            <textarea id="gv-prompt" rows={3} placeholder={prompt} readOnly onFocus={onUse} onClick={onUse} />
            <div className="gv-compose-actions">
              <button type="button" className="gv-upload" onClick={onUse} aria-label="Add media"><Upload size={17} /></button>
              <button type="button" className="gv-submit" onClick={onUse}>Continue <ArrowRight size={16} /></button>
            </div>
          </div>
        </div>
        <img className="gv-art" src={`/assets/explore/${entry.id}.webp`} alt="" />
      </div>
      {page ? (
        <section className="gv-about" aria-labelledby="gv-about-title">
          <h2 id="gv-about-title">{page.headline}</h2>
          <p>{page.body}</p>
          <ul>
            {page.points.map((point) => <li key={point}>{point}</li>)}
          </ul>
        </section>
      ) : null}
      <SiteFooter theme={theme} />
    </section>
  );
}

export function SignInDialog({ open, onClose, googleConfigured, theme }: { open: boolean; onClose: () => void; googleConfigured: boolean; theme: Theme }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const [appleBusy, setAppleBusy] = useState(false);
  const [appleError, setAppleError] = useState("");
  if (!open) return null;
  const next = window.location.pathname + window.location.search + window.location.hash;
  const signInUrl = `/api/auth/google?mode=signin&next=${encodeURIComponent(next)}`;
  // App Review requires Sign in with Apple wherever Google sign-in is offered on iOS.
  const appleAvailable = nativePlatform() === "ios";
  const continueWithApple = () => {
    setAppleBusy(true);
    setAppleError("");
    signInWithApple(next).catch((error) => {
      setAppleBusy(false);
      if (!(error instanceof AuthCancelled)) setAppleError(messageOf(error) || "Sign in with Apple failed. Try again.");
    });
  };
  return (
    <div className="gv-dialog-backdrop" data-theme={theme} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="gv-dialog" role="dialog" aria-modal="true" aria-labelledby="gv-dialog-title">
        <button type="button" className="gv-dialog-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <span className="gv-dialog-mark"><Sparkles size={23} /></span>
        <h2 id="gv-dialog-title">Make it with AutoYT</h2>
        <p>Sign in to create, save, and use your tools across devices.</p>
        {appleAvailable ? <button type="button" className="gv-apple" onClick={continueWithApple} disabled={appleBusy} aria-busy={appleBusy}><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.37 12.6c.02 2.5 2.2 3.33 2.22 3.34-.02.06-.35 1.18-1.14 2.34-.69 1-1.4 2-2.53 2.02-1.1.02-1.46-.65-2.73-.65-1.26 0-1.66.63-2.7.67-1.09.04-1.92-1.08-2.61-2.08-1.42-2.05-2.5-5.8-1.05-8.33a4.05 4.05 0 0 1 3.42-2.08c1.07-.02 2.08.72 2.73.72.65 0 1.88-.89 3.17-.76.54.02 2.05.22 3.02 1.64-.08.05-1.8 1.05-1.8 3.13ZM14.3 5.44c.58-.7.97-1.68.86-2.65-.83.03-1.84.55-2.44 1.25-.53.62-1 1.62-.88 2.57.93.07 1.88-.47 2.46-1.17Z"/></svg>{appleBusy ? "Signing in…" : "Continue with Apple"}</button> : null}
        {appleError ? <p className="gv-auth-error" role="alert">{appleError}</p> : null}
        {googleConfigured ? <a className="gv-google" href={signInUrl}><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.35 12.2c0-.71-.06-1.39-.19-2.05H12v3.87h5.24a4.47 4.47 0 0 1-1.95 2.94v2.46h3.17c1.85-1.71 2.89-4.22 2.89-7.22Z"/><path fill="#34A853" d="M12 21.7c2.64 0 4.85-.88 6.46-2.38l-3.17-2.46c-.88.59-2 .94-3.29.94-2.53 0-4.68-1.71-5.45-4.01H3.28v2.53A9.75 9.75 0 0 0 12 21.7Z"/><path fill="#FBBC05" d="M6.55 13.79a5.86 5.86 0 0 1 0-3.58V7.68H3.28a9.75 9.75 0 0 0 0 8.64l3.27-2.53Z"/><path fill="#EA4335" d="M12 6.2c1.44 0 2.73.5 3.75 1.47l2.81-2.82A9.34 9.34 0 0 0 12 2.3a9.75 9.75 0 0 0-8.72 5.38l3.27 2.53C7.32 7.91 9.47 6.2 12 6.2Z"/></svg>Continue with Google</a> : <p className="gv-auth-error">Google sign-in is temporarily unavailable. Please try again later.</p>}
        <button type="button" className="gv-later" onClick={onClose}>Keep exploring</button>
      </section>
    </div>
  );
}
