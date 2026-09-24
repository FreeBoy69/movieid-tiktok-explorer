// The app's one video player. Controls follow the conventions people know from
// YouTube, Vimeo, and Plyr: a large play button until the first play, click to
// play or pause, a bottom bar that hides while a video plays and the pointer
// rests, a scrubber with buffered range and a hover time, volume, speed,
// picture-in-picture, download, and fullscreen. Keyboard (with the player
// focused): Space/K play, J/L 10s, arrows 5s and volume, M mute, F fullscreen,
// 0-9 jump to a tenth, Home/End.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type VideoHTMLAttributes } from "react";
import { Download, Loader2, Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, Volume1, Volume2, VolumeX } from "lucide-react";
import "./VideoPlayer.css";

type Props = {
  src: string;
  poster?: string;
  label?: string;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  // CSS aspect-ratio for the frame, e.g. "9 / 16". Without it the video's own shape is used.
  aspect?: string;
  fit?: "contain" | "cover";
  // "fill" spans its container; "fit" shrinks to the video (lightboxes, zoom views).
  size?: "fill" | "fit";
  // A download button in the bar; a string sets the file name.
  download?: boolean | string;
  className?: string;
  style?: CSSProperties;
  videoProps?: VideoHTMLAttributes<HTMLVideoElement>;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const HIDE_AFTER_MS = 2500;
const STORE = "autoyt.player.volume";

export const clock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};
function savedVolume(): { volume: number; muted: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(STORE) || "null");
    if (value && typeof value.volume === "number") return { volume: Math.min(1, Math.max(0, value.volume)), muted: Boolean(value.muted) };
  } catch {}
  return { volume: 1, muted: false };
}

export const VideoPlayer = forwardRef<HTMLVideoElement | null, Props>(function VideoPlayer(
  { src, poster, label = "Video", autoPlay = false, loop = false, muted, aspect, fit = "contain", size = "fill", download, className = "", style, videoProps },
  forwarded,
) {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useImperativeHandle(forwarded, () => video.current as HTMLVideoElement);

  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(autoPlay);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [initial] = useState(savedVolume);
  const [volume, setVolume] = useState(initial.volume);
  const [isMuted, setMuted] = useState(muted ?? initial.muted);
  const [speed, setSpeed] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [flash, setFlash] = useState<"play" | "pause" | null>(null);

  const v = () => video.current;
  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setIdle(true), HIDE_AFTER_MS);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  useEffect(() => {
    setFailed(false);
    setTime(0);
    setDuration(0);
    setBuffered(0);
    setStarted(autoPlay);
  }, [src, autoPlay]);
  useEffect(() => {
    const el = v();
    if (!el) return;
    el.volume = volume;
    el.muted = isMuted;
    if (muted === undefined)
      try {
        localStorage.setItem(STORE, JSON.stringify({ volume, muted: isMuted }));
      } catch {}
  }, [volume, isMuted, muted]);
  // The speed menu closes on Escape or any press outside it.
  useEffect(() => {
    if (!speedOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest?.(".vp-speed")) setSpeedOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setSpeedOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [speedOpen]);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    const el = v();
    if (!el || failed) return;
    setStarted(true);
    if (el.paused || el.ended) {
      void el.play().catch(() => {});
      setFlash("play");
    } else {
      el.pause();
      setFlash("pause");
    }
    setTimeout(() => setFlash(null), 450);
  }, [failed]);
  const seek = (to: number) => {
    const el = v();
    if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = Math.min(el.duration, Math.max(0, to));
    setTime(el.currentTime);
  };
  const toggleFullscreen = () => {
    if (!root.current) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else if (root.current.requestFullscreen) void root.current.requestFullscreen().catch(() => {});
    // iPhone Safari has no element fullscreen, only the native video one.
    else (v() as HTMLVideoElement & { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen?.();
  };
  const togglePip = () => {
    const el = v();
    if (!el) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
    else void el.requestPictureInPicture?.().catch(() => {});
  };
  const setLevel = (next: number) => {
    const level = Math.min(1, Math.max(0, next));
    setVolume(level);
    setMuted(level === 0);
  };
  const retry = () => {
    const el = v();
    if (!el) return;
    setFailed(false);
    el.load();
  };

  const timeAt = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || !duration) return 0;
    return (Math.min(box.width, Math.max(0, clientX - box.left)) / box.width) * duration;
  };

  function onKey(event: React.KeyboardEvent) {
    if ((event.target as HTMLElement).closest(".vp-menu")) return;
    const key = event.key.toLowerCase();
    const el = v();
    if (!el) return;
    const handled = () => {
      event.preventDefault();
      wake();
    };
    const onSlider = (event.target as HTMLElement).getAttribute("role") === "slider";
    if (key === " " || key === "k") {
      if ((event.target as HTMLElement).tagName === "BUTTON" && key === " ") return;
      handled();
      toggle();
    } else if (key === "j") (handled(), seek(el.currentTime - 10));
    else if (key === "l") (handled(), seek(el.currentTime + 10));
    else if (key === "arrowleft" && !onSlider) (handled(), seek(el.currentTime - 5));
    else if (key === "arrowright" && !onSlider) (handled(), seek(el.currentTime + 5));
    else if (key === "arrowup" && !onSlider) (handled(), setLevel(volume + 0.05));
    else if (key === "arrowdown" && !onSlider) (handled(), setLevel(volume - 0.05));
    else if (key === "m") (handled(), setMuted(!isMuted));
    else if (key === "f") (handled(), toggleFullscreen());
    else if (key === "home") (handled(), seek(0));
    else if (key === "end") (handled(), seek(duration));
    else if (/^[0-9]$/.test(key)) (handled(), seek((Number(key) / 10) * duration));
  }

  const showBar = !started ? false : !playing || !idle || scrubbing || speedOpen;
  const progress = duration ? (time / duration) * 100 : 0;
  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const pipSupported = typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;
  const fileName = typeof download === "string" ? download : true;

  return (
    <div
      ref={root}
      className={`vp is-${size} ${showBar ? "is-bar" : ""} ${playing ? "is-playing" : ""} ${fullscreen ? "is-fullscreen" : ""} ${idle && playing ? "is-idle" : ""} ${className}`}
      style={{ ...(aspect ? { aspectRatio: aspect } : {}), ...style }}
      tabIndex={0}
      role="group"
      aria-label={label}
      onKeyDown={onKey}
      onPointerMove={wake}
      onPointerLeave={() => playing && setIdle(true)}
      onFocus={wake}
    >
      <video
        {...videoProps}
        ref={video}
        className={`vp-video is-${fit}`}
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        loop={loop}
        muted={isMuted}
        playsInline
        preload={videoProps?.preload || "metadata"}
        onClick={toggle}
        onDoubleClick={toggleFullscreen}
        onPlay={(event) => {
          setPlaying(true);
          setStarted(true);
          wake();
          videoProps?.onPlay?.(event);
        }}
        onPause={(event) => {
          setPlaying(false);
          setIdle(false);
          videoProps?.onPause?.(event);
        }}
        onEnded={(event) => {
          setPlaying(false);
          setIdle(false);
          videoProps?.onEnded?.(event);
        }}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
          event.currentTarget.playbackRate = speed;
          videoProps?.onLoadedMetadata?.(event);
        }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => {
          if (!scrubbing) setTime(event.currentTarget.currentTime);
          videoProps?.onTimeUpdate?.(event);
        }}
        onProgress={(event) => {
          const el = event.currentTarget;
          if (el.buffered.length && el.duration) setBuffered((el.buffered.end(el.buffered.length - 1) / el.duration) * 100);
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onError={(event) => {
          setFailed(true);
          setWaiting(false);
          videoProps?.onError?.(event);
        }}
      />

      {failed ? (
        <div className="vp-center vp-error" role="alert">
          <strong>This video couldn’t load</strong>
          <span>It may still be processing, or the file is no longer available.</span>
          <button type="button" className="vp-pill" onClick={retry}>
            <RotateCcw size={15} /> Try again
          </button>
        </div>
      ) : !started ? (
        <button type="button" className="vp-center vp-big" onClick={toggle} aria-label={`Play ${label}`}>
          <Play size={30} fill="currentColor" />
        </button>
      ) : waiting ? (
        <span className="vp-center vp-spinner" role="status" aria-label="Loading">
          <Loader2 size={34} />
        </span>
      ) : flash ? (
        <span className="vp-center vp-flash" aria-hidden="true">
          {flash === "play" ? <Play size={26} fill="currentColor" /> : <Pause size={26} fill="currentColor" />}
        </span>
      ) : null}

      {started && !failed && (
        <div className="vp-bar" onPointerDown={(event) => event.stopPropagation()}>
          <div
            ref={track}
            className="vp-track"
            role="slider"
            tabIndex={0}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(time)}
            aria-valuetext={`${clock(time)} of ${clock(duration)}`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setScrubbing(true);
              const to = timeAt(event.clientX);
              setTime(to);
              seek(to);
            }}
            onPointerMove={(event) => {
              const to = timeAt(event.clientX);
              const box = track.current!.getBoundingClientRect();
              setHover({ x: Math.min(box.width, Math.max(0, event.clientX - box.left)), time: to });
              if (scrubbing) {
                setTime(to);
                seek(to);
              }
            }}
            onPointerUp={() => setScrubbing(false)}
            onPointerCancel={() => setScrubbing(false)}
            onPointerLeave={() => !scrubbing && setHover(null)}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 10 : 5;
              if (event.key === "ArrowLeft" || event.key === "ArrowDown") (event.preventDefault(), seek(time - step));
              if (event.key === "ArrowRight" || event.key === "ArrowUp") (event.preventDefault(), seek(time + step));
            }}
          >
            <span className="vp-rail">
              <span className="vp-buffered" style={{ width: `${buffered}%` }} />
              <span className="vp-played" style={{ width: `${progress}%` }} />
            </span>
            <span className="vp-thumb" style={{ left: `${progress}%` }} />
            {hover && duration > 0 && (
              <span className="vp-tip" style={{ left: hover.x }}>
                {clock(hover.time)}
              </span>
            )}
          </div>

          <div className="vp-row">
            <button type="button" className="vp-btn" onClick={toggle} aria-label={playing ? "Pause (k)" : "Play (k)"}>
              {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
            <div className="vp-volume">
              <button type="button" className="vp-btn" onClick={() => setMuted(!isMuted)} aria-label={isMuted ? "Unmute (m)" : "Mute (m)"}>
                <VolumeIcon size={18} />
              </button>
              <input
                className="vp-level"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                aria-label="Volume"
                aria-valuetext={`${Math.round((isMuted ? 0 : volume) * 100)}%`}
                onChange={(event) => setLevel(Number(event.target.value))}
                style={{ "--vp-level": `${(isMuted ? 0 : volume) * 100}%` } as CSSProperties}
              />
            </div>
            <span className="vp-time">
              {clock(time)} <span>/ {clock(duration)}</span>
            </span>
            <span className="vp-spacer" />
            <div className="vp-speed">
              <button type="button" className="vp-btn vp-text" aria-haspopup="menu" aria-expanded={speedOpen} aria-label={`Playback speed ${speed}×`} onClick={() => setSpeedOpen(!speedOpen)}>
                {speed === 1 ? "1×" : `${speed}×`}
              </button>
              {speedOpen && (
                <div className="vp-menu" role="menu" aria-label="Playback speed" onKeyDown={(event) => event.key === "Escape" && setSpeedOpen(false)}>
                  {SPEEDS.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      role="menuitemradio"
                      aria-checked={rate === speed}
                      onClick={() => {
                        setSpeed(rate);
                        if (v()) v()!.playbackRate = rate;
                        setSpeedOpen(false);
                      }}
                    >
                      {rate === 1 ? "Normal" : `${rate}×`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {pipSupported && (
              <button type="button" className="vp-btn vp-hide-sm" onClick={togglePip} aria-label="Picture in picture">
                <PictureInPicture2 size={18} />
              </button>
            )}
            {download && (
              <a className="vp-btn vp-dl" href={src} download={fileName} aria-label="Download video">
                <Download size={18} />
              </a>
            )}
            <button type="button" className="vp-btn" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit full screen (f)" : "Full screen (f)"}>
              {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
