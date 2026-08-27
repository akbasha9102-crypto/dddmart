import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeFakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void store.set(key, value)),
    removeItem: vi.fn((key: string) => void store.delete(key)),
  };
}

describe("posSounds mute persistence", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to unmuted when localStorage has no stored value", async () => {
    vi.stubGlobal("window", { localStorage: makeFakeLocalStorage() });
    const { isMuted } = await import("./posSounds");
    expect(isMuted()).toBe(false);
  });

  it("setMuted persists to localStorage and isMuted reflects it", async () => {
    const localStorage = makeFakeLocalStorage();
    vi.stubGlobal("window", { localStorage });
    const { isMuted, setMuted } = await import("./posSounds");
    setMuted(true);
    expect(isMuted()).toBe(true);
    expect(localStorage.setItem).toHaveBeenCalledWith("dddmart:pos-sound-muted", "1");
  });

  it("reads a previously-persisted muted=true value on module load", async () => {
    const localStorage = makeFakeLocalStorage();
    localStorage.getItem.mockReturnValue("1");
    vi.stubGlobal("window", { localStorage });
    const { isMuted } = await import("./posSounds");
    expect(isMuted()).toBe(true);
  });
});

describe("posSounds playback gating when muted", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("playScanBeep does not construct AudioContext when muted", async () => {
    const AudioContextCtor = vi.fn();
    const localStorage = makeFakeLocalStorage();
    localStorage.getItem.mockReturnValue("1"); // start muted
    vi.stubGlobal("window", { localStorage, AudioContext: AudioContextCtor });
    const { playScanBeep } = await import("./posSounds");
    playScanBeep();
    expect(AudioContextCtor).not.toHaveBeenCalled();
  });

  it("playSuccessChime does not construct AudioContext when muted", async () => {
    const AudioContextCtor = vi.fn();
    const localStorage = makeFakeLocalStorage();
    localStorage.getItem.mockReturnValue("1");
    vi.stubGlobal("window", { localStorage, AudioContext: AudioContextCtor });
    const { playSuccessChime } = await import("./posSounds");
    playSuccessChime();
    expect(AudioContextCtor).not.toHaveBeenCalled();
  });

  it("playScanBeep does construct AudioContext (via oscillator/gain) when unmuted", async () => {
    const oscillator = { type: "", frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() };
    const ctxInstance = {
      currentTime: 0,
      destination: {},
      createOscillator: vi.fn(() => oscillator),
      createGain: vi.fn(() => gain),
    };
    const AudioContextCtor = vi.fn(() => ctxInstance);
    const localStorage = makeFakeLocalStorage(); // unmuted by default
    vi.stubGlobal("window", { localStorage, AudioContext: AudioContextCtor });
    const { playScanBeep } = await import("./posSounds");
    playScanBeep();
    expect(AudioContextCtor).toHaveBeenCalledTimes(1);
    expect(ctxInstance.createOscillator).toHaveBeenCalledTimes(1);
    expect(oscillator.start).toHaveBeenCalledTimes(1);
  });
});

describe("posSounds AudioContext resume handling", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeFakeAudioContext(state: string) {
    const oscillator = { type: "", frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() };
    return {
      state,
      currentTime: 0,
      destination: {},
      createOscillator: vi.fn(() => oscillator),
      createGain: vi.fn(() => gain),
      resume: vi.fn(),
    };
  }

  it("resumes the AudioContext when playScanBeep runs and the context is suspended", async () => {
    const ctxInstance = makeFakeAudioContext("suspended");
    const AudioContextCtor = vi.fn(() => ctxInstance);
    vi.stubGlobal("window", { localStorage: makeFakeLocalStorage(), AudioContext: AudioContextCtor });
    const { playScanBeep } = await import("./posSounds");
    playScanBeep();
    expect(ctxInstance.resume).toHaveBeenCalledTimes(1);
  });

  it("does not call resume when the context is already running", async () => {
    const ctxInstance = makeFakeAudioContext("running");
    const AudioContextCtor = vi.fn(() => ctxInstance);
    vi.stubGlobal("window", { localStorage: makeFakeLocalStorage(), AudioContext: AudioContextCtor });
    const { playScanBeep } = await import("./posSounds");
    playScanBeep();
    expect(ctxInstance.resume).not.toHaveBeenCalled();
  });

  it("resumes an existing suspended context on visibilitychange when the page becomes visible", async () => {
    const ctxInstance = makeFakeAudioContext("suspended");
    const AudioContextCtor = vi.fn(() => ctxInstance);
    const listeners: Record<string, () => void> = {};
    const fakeDocument = {
      visibilityState: "visible",
      addEventListener: vi.fn((event: string, handler: () => void) => {
        listeners[event] = handler;
      }),
    };
    vi.stubGlobal("window", {
      localStorage: makeFakeLocalStorage(),
      AudioContext: AudioContextCtor,
      document: fakeDocument,
    });
    const { playScanBeep } = await import("./posSounds");
    playScanBeep(); // creates the context and triggers the initial resume() call
    ctxInstance.resume.mockClear();

    expect(fakeDocument.addEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    listeners["visibilitychange"]?.();

    expect(ctxInstance.resume).toHaveBeenCalledTimes(1);
  });

  it("playScanBeep does not throw when createOscillator throws", async () => {
    const AudioContextCtor = vi.fn(() => ({
      state: "running",
      currentTime: 0,
      destination: {},
      createOscillator: vi.fn(() => {
        throw new Error("boom");
      }),
      createGain: vi.fn(() => ({ gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() })),
      resume: vi.fn(),
    }));
    vi.stubGlobal("window", { localStorage: makeFakeLocalStorage(), AudioContext: AudioContextCtor });
    const { playScanBeep } = await import("./posSounds");
    expect(() => playScanBeep()).not.toThrow();
  });

  it("playSuccessChime does not throw when oscillator.start throws", async () => {
    const oscillator = {
      type: "",
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(() => {
        throw new Error("boom");
      }),
      stop: vi.fn(),
    };
    const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() };
    const AudioContextCtor = vi.fn(() => ({
      state: "running",
      currentTime: 0,
      destination: {},
      createOscillator: vi.fn(() => oscillator),
      createGain: vi.fn(() => gain),
      resume: vi.fn(),
    }));
    vi.stubGlobal("window", { localStorage: makeFakeLocalStorage(), AudioContext: AudioContextCtor });
    const { playSuccessChime } = await import("./posSounds");
    expect(() => playSuccessChime()).not.toThrow();
  });
});
