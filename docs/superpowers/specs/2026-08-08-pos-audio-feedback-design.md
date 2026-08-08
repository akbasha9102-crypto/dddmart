# POS Audio Feedback (مؤثرات صوتية للكاشير) — Design

## Problem

The cashier gets no audio confirmation when a product is scanned/added to the
cart or when a sale completes — a busy cashier scanning fast has to glance at
the screen to confirm each beep-worthy event actually registered. The client
wants two synthesized sounds (no external audio files, so it keeps working
offline and adds zero load latency) plus a mute toggle.

## Goals (from the client's request, already fully specified)

- Short, high-pitched beep on: barcode scan success OR manual add-to-cart.
- Distinct short "success chime" (double-beep) on: sale/checkout completed.
- Generated in-browser via Web Audio API (`AudioContext`/`OscillatorNode`) —
  no `.mp3`/`.wav` files, so it works fully offline and has no fetch latency.
- A mute/unmute toggle, quick to reach from the POS screen (not buried in
  settings) — a cashier needs to kill the sound instantly if it's disruptive.
- Zero perceptible latency during rapid consecutive scans.

## Where sounds get triggered

Traced the actual code — both the barcode scanner path (HID + camera) and
the manual product picker converge on a single function,
`hooks/usePOS.ts#addProductToCart` (`scanBarcode` itself calls
`addProductToCart` internally after resolving the barcode). This means the
beep only needs to be wired into **one** place to cover all three entry
methods, matching this repo's existing "everything converges on
`addItem`" invariant (see [[project_ddd_mart]]).

The success chime fires from `hooks/usePOS.ts#checkout`, right after each of
its two successful-completion points (`setLastReceipt(result)` /
`setLastReceipt(resultWithCustomerName)`, one per online/offline branch) —
i.e. only on confirmed success, never when `createSale`/validation throws.

## Implementation

New `lib/audio/posSounds.ts` — a tiny, dependency-free module:

- One lazily-created, module-level `AudioContext` singleton (browsers require
  a user gesture before audio can play; since this only ever gets called
  from inside click/scan handlers that are themselves triggered by a user
  action, the context can be created and immediately used on first call, no
  separate "unlock" step needed).
- `playScanBeep()` — a single short sine `OscillatorNode` (~1800 Hz, ~70ms)
  through a `GainNode` envelope (fast linear ramp up/down, not a hard on/off,
  to avoid an audible click/pop) connected to `audioContext.destination`.
- `playSuccessChime()` — two short oscillator tones in sequence (e.g. 880 Hz
  then 1320 Hz, ~90ms each, tiny gap between), same envelope technique.
- A module-level mute flag, not React state, so playback in the hot scanning
  path never waits on a render: `isMuted()` reads a `let` variable that's
  kept in sync with `localStorage` (`dddmart:pos-sound-muted`), `setMuted()`
  updates both. Both play functions early-return immediately if muted —
  before touching the `AudioContext` at all — so muting has zero overhead.
- Every oscillator/gain node created per beep is a cheap, short-lived object
  (Web Audio's own recommended pattern — nodes are not reused/pooled), so
  back-to-back scans each get a fresh, non-overlapping tone with no
  measurable setup cost (`AudioContext` itself is the only persistent/reused
  object).

`hooks/useSoundSettings.ts` — thin React wrapper around `posSounds.ts`'s
mute state for the toggle button: exposes `{ isMuted, toggle }`, backed by
the same `localStorage` key, so the UI re-renders on toggle while the actual
playback path stays render-independent.

## UI

Small speaker icon button (🔊/🔇, via `lucide-react`'s `Volume2`/`VolumeX`)
added to the POS page header, next to the existing "المرتجعات"/"الفواتير
المعلقة" buttons — a quick toggle, not tucked into Settings, since the
person who needs to mute it is standing at the till, not in a menu three
taps away.

## Testing

- Since `AudioContext`/`OscillatorNode` aren't available in the Vitest/jsdom
  environment, unit-test the parts that don't need real audio: the mute
  flag's `localStorage` persistence (`isMuted`/`setMuted` round-trip), and
  that `playScanBeep`/`playSuccessChime` early-return without touching
  `AudioContext` at all when muted (mock `window.AudioContext` with a
  `vi.fn()` constructor and assert it's never called in the muted case).
- `npm run typecheck && npm run lint && npm run build` must all pass.
- Manual verification in an actual browser (not just automated tests, since
  audio output can't be asserted by Vitest): rapid-fire scan 10+ items in a
  row and confirm no lag/stutter in the UI or delayed/dropped beeps, confirm
  the success chime plays once per completed sale (cash and credit), confirm
  muting silences both sounds immediately and persists after a page reload.
