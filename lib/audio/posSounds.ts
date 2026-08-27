const MUTE_STORAGE_KEY = "dddmart:pos-sound-muted";

let audioContext: AudioContext | null = null;
let muted = readMutedFromStorage();

function readMutedFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === "1";
  } catch {
    return false; // localStorage can throw (Safari private mode, disabled storage)
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // ignore write failures; in-memory `muted` flag still updated for this session
  }
}

function resumeIfSuspended(ctx: AudioContext): void {
  if (ctx.state === "suspended") {
    // Fire-and-forget: browsers (esp. mobile Chrome/Safari) auto-suspend the
    // AudioContext when the tab backgrounds. Resuming is async, but callers
    // of playScanBeep/playSuccessChime must stay synchronous, so we don't await.
    void ctx.resume();
  }
}

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioContext = new Ctor();
  }
  resumeIfSuspended(audioContext);
  return audioContext;
}

if (typeof window !== "undefined") {
  window.document?.addEventListener("visibilitychange", () => {
    if (window.document.visibilityState === "visible" && audioContext) {
      resumeIfSuspended(audioContext);
    }
  });
}

function playTone(ctx: AudioContext, frequency: number, startTime: number, duration: number): void {
  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;

    // Fast linear ramp up/down (not a hard on/off) to avoid an audible click/pop.
    const attack = 0.005;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.3, startTime + attack);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  } catch {
    // Best-effort: a failure to schedule/play a tone (e.g. AudioContext in a
    // "closed" state) must never block the caller (barcode scan / checkout flow).
  }
}

export function playScanBeep(): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  playTone(ctx, 1800, ctx.currentTime, 0.07);
}

export function playSuccessChime(): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const toneDuration = 0.09;
  const gap = 0.03;
  playTone(ctx, 880, now, toneDuration);
  playTone(ctx, 1320, now + toneDuration + gap, toneDuration);
}
