// The app's one video player. Controls follow the conventions people know from
// YouTube, Vimeo, and Plyr: a large play button until the first play, click to
// play or pause, a bottom bar that hides while a video plays and the pointer
// rests, a scrubber with buffered range and a hover time, volume, speed,
// picture-in-picture, download, and fullscreen, plus 10-second skips, loop, a
// remaining-time readout, a title over the picture, and a shortcuts panel.
// Keyboard (with the player focused): Space/K play, J/L 10s, arrows 5s and
// volume, , and . a frame (paused), < and > speed, M mute, F fullscreen, R loop,
// 0-9 jump to a tenth, Home/End, ? shortcuts.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type VideoHTMLAttributes } from "react";
import { Download, Keyboard, Loader2, Maximize, Minimize, Pause, PictureInPicture2, Play, Repeat, RotateCcw, RotateCw, Volume1, Volume2, VolumeX } from "lucide-react";
import "./VideoPlayer.css";

type Props = {
  src: string;
  poster?: string;
  label?: string;
  // Shown over the top of the picture while the controls are (YouTube's title bar).
  title?: string;
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

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const FRAME = 1 / 30;
const SHORTCUTS: Array<[string, string]> = [
  ["Space or K", "Play or pause"],
  ["J / L", "Back or forward 10 seconds"],
  ["← / →", "Back or forward 5 seconds"],
  [", / .", "One frame back or forward (paused)"],
  ["< / >", "Slower or faster"],
  ["↑ / ↓", "Volume"],
  ["M", "Mute"],
  ["R", "Loop"],
  ["F", "Full screen"],
  ["0 to 9", "Jump to 0% to 90%"],
  ["Home / End", "Start or end"],
];
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
  { src, poster, label = "Video", title, autoPlay = false, loop = false, muted, aspect, fit = "contain", size = "fill", download, className = "", style, videoProps },
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
  const [flash, setFlash] = useState<"play" | "pause" | "back" | "forward" | null>(null);
  const [looping, setLooping] = useState(loop);
  const [remaining, setRemaining] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => setLooping(loop), [loop]);

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
  const skip = (by: number) => {
    const el = v();
    if (!el) return;
    seek(el.currentTime + by);
    setFlash(by < 0 ? "back" : "forward");
    setTimeout(() => setFlash(null), 450);
  };
  const step = (frames: number) => {
    const el = v();
    if (!el) return;
    if (!el.paused) el.pause();
    seek(el.currentTime + frames * FRAME);
  };
  const changeSpeed = (rate: number) => {
    setSpeed(rate);
    if (v()) v()!.playbackRate = rate;
  };
  const nudgeSpeed = (direction: number) => {
    const at = SPEEDS.indexOf(speed);
    changeSpeed(SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (at < 0 ? SPEEDS.indexOf(1) : at) + direction))]);
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
    if (event.key === "Escape" && helpOpen) {
      event.preventDefault();
      setHelpOpen(false);
      return;
    }
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
    } else if (key === "j") (handled(), skip(-10));
    else if (key === "l") (handled(), skip(10));
    else if (event.key === ",") (handled(), step(-1));
    else if (event.key === ".") (handled(), step(1));
    else if (event.key === "<") (handled(), nudgeSpeed(-1));
    else if (event.key === ">") (handled(), nudgeSpeed(1));
    else if (event.key === "?") (handled(), setHelpOpen((open) => !open));
    else if (key === "r") (handled(), setLooping((on) => !on));
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

  const showBar = !started ? false : !playing || !idle || scrubbing || speedOpen || helpOpen;
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
        loop={looping}
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
          {flash === "play" ? <Play size={26} fill="currentColor" /> : flash === "pause" ? <Pause size={26} fill="currentColor" /> : flash === "back" ? <><RotateCcw size={24} /><b>10</b></> : <><RotateCw size={24} /><b>10</b></>}
        </span>
      ) : null}

      {title ? <div className="vp-top" aria-hidden="true">{title}</div> : null}
      {helpOpen ? (
        <div className="vp-help" role="dialog" aria-label="Keyboard shortcuts" onPointerDown={(event) => event.stopPropagation()}>
          <div className="vp-help-head">
            <strong>Keyboard shortcuts</strong>
            <button type="button" className="vp-pill" onClick={() => setHelpOpen(false)}>Close</button>
          </div>
          <dl>
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys}><dt>{keys}</dt><dd>{what}</dd></div>
            ))}
          </dl>
        </div>
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
            <button type="button" className="vp-btn vp-skip" onClick={() => skip(-10)} aria-label="Back 10 seconds (j)" title="Back 10 seconds (J)">
              <RotateCcw size={18} /><b>10</b>
            </button>
            <button type="button" className="vp-btn vp-skip" onClick={() => skip(10)} aria-label="Forward 10 seconds (l)" title="Forward 10 seconds (L)">
              <RotateCw size={18} /><b>10</b>
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
            <button type="button" className="vp-time" onClick={() => setRemaining(!remaining)} title={remaining ? "Show elapsed time" : "Show time left"}>
              {remaining ? `-${clock(Math.max(0, duration - time))}` : clock(time)} <span>/ {clock(duration)}</span>
            </button>
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
                        changeSpeed(rate);
                        setSpeedOpen(false);
                      }}
                    >
                      {rate === 1 ? "Normal" : `${rate}×`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className={`vp-btn vp-hide-sm${looping ? " is-on" : ""}`} onClick={() => setLooping(!looping)} aria-pressed={looping} aria-label="Loop (r)" title="Loop (R)">
              <Repeat size={17} />
            </button>
            <button type="button" className={`vp-btn vp-hide-sm${helpOpen ? " is-on" : ""}`} onClick={() => setHelpOpen(!helpOpen)} aria-pressed={helpOpen} aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)">
              <Keyboard size={18} />
            </button>
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
