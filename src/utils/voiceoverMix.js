/** @param {{ duration: number, backgroundVolume?: number }} options */
export function voiceoverMixInputs(sourcePath, voicePath, backgroundPath, { duration, backgroundVolume = 0.3 } = { duration: 0 }) {
    const seconds = Number(duration);
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("A positive video duration is required.");
    const level = Number(backgroundVolume);
    const gain = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0.3;
    const inputs = ["-y", "-i", sourcePath, "-i", voicePath];
    // Never mix source audio back in: it still contains the narrator being replaced.
    if (backgroundPath) inputs.push("-i", backgroundPath);
    const voice = "[1:a]aresample=48000,apad[narration]";
    const mix = backgroundPath
        ? `${voice};[2:a]aresample=48000,volume=${gain},apad[background];[narration][background]amix=inputs=2:normalize=0:duration=longest[mixed];[mixed]`
        : `${voice};[narration]`;
    return [...inputs, "-filter_complex", `${mix}alimiter=limit=0.95:level=0:latency=1,atrim=duration=${seconds.toFixed(6)}[mix]`, "-map", "0:v:0", "-map", "[mix]"];
}
