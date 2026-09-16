/**
 * Browser speech wrappers for the simulated Alexa+ device.
 *
 *  - Recognition: the Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`, Chrome, Edge and Safari).
 *    lib.dom ships the result types (`SpeechRecognitionResultList` …) but not the recognizer itself, so the minimal
 *    surface used here is declared locally.
 *  - Synthesis: `speechSynthesis`, available everywhere. One utterance at a time; a new `speak()` cancels the
 *    current one.
 */

export interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionErrorEventLike extends Event {
  /** 'no-speech' | 'aborted' | 'audio-capture' | 'network' | 'not-allowed' | 'service-not-allowed' | … */
  readonly error: string;
  readonly message: string;
}

export interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: ((this: SpeechRecognitionLike, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((this: SpeechRecognitionLike, ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((this: SpeechRecognitionLike, ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

// --- recognition ---------------------------------------------------------------------------------

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function isRecognitionSupported(): boolean {
  return recognitionCtor() !== null;
}

export interface RecognitionHandlers {
  /** The microphone is open (fires after the permission prompt, if any). */
  onStart?(): void;
  /** Live transcript while the person is still talking. */
  onInterim(text: string): void;
  /** Fires exactly once when the microphone is released, before `onFinal`. */
  onEnd(): void;
  /** The finished utterance (also delivered when stopped mid-sentence). Not called after `abort()`. */
  onFinal(text: string): void;
  onError(message: string, code: string): void;
}

export interface RecognitionSession {
  /** Stop listening; whatever was heard is delivered through `onFinal`. */
  stop(): void;
  /** Stop listening and discard what was heard. */
  abort(): void;
}

function describeRecognitionError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return "Microphone access is blocked — allow it in the browser's site settings, or type instead.";
    case 'no-speech':
      return "I didn't hear anything. Try again, or type below.";
    case 'audio-capture':
      return 'No microphone was found.';
    case 'network':
      return 'The speech service could not be reached (voice input needs an internet connection).';
    case 'language-not-supported':
      return 'English speech recognition is not available in this browser.';
    default:
      return `Voice input failed (${code}).`;
  }
}

/**
 * Opens the microphone for a single utterance (`continuous = false`, interim results on, en-US).
 * Returns null when the browser has no speech recognition or the microphone could not be started.
 */
export function startRecognition(handlers: RecognitionHandlers): RecognitionSession | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = 'en-US';
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = '';
  let interimText = '';
  let cancelled = false;
  let ended = false;

  rec.onstart = () => handlers.onStart?.();
  rec.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const result = ev.results[i];
      if (!result) continue;
      const transcript = result[0]?.transcript ?? '';
      if (result.isFinal) finalText += transcript;
      else interim += transcript;
    }
    interimText = interim;
    handlers.onInterim(`${finalText} ${interim}`.replace(/\s+/g, ' ').trim());
  };
  rec.onerror = (ev) => {
    if (ev.error === 'aborted') return;
    handlers.onError(describeRecognitionError(ev.error), ev.error);
  };
  rec.onend = () => {
    if (ended) return;
    ended = true;
    // Chrome sometimes ends without upgrading the last interim result to a final one; use what we have.
    const text = (finalText || interimText).replace(/\s+/g, ' ').trim();
    handlers.onEnd();
    if (!cancelled && text) handlers.onFinal(text);
  };

  try {
    rec.start();
  } catch {
    handlers.onError('Could not start the microphone.', 'start-failed');
    if (!ended) {
      ended = true;
      handlers.onEnd();
    }
    return null;
  }

  return {
    stop: () => rec.stop(),
    abort: () => {
      cancelled = true;
      rec.abort();
    },
  };
}

// --- synthesis -----------------------------------------------------------------------------------

export function isSynthesisSupported(): boolean {
  return (
    typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
  );
}

let voicesBound = false;
let preferredVoice: SpeechSynthesisVoice | null = null;

function scoreVoice(voice: SpeechSynthesisVoice): number {
  const lang = voice.lang.toLowerCase().replace('_', '-');
  if (!lang.startsWith('en')) return -1;
  let score = 1;
  if (lang === 'en-us') score += 2;
  if (voice.default) score += 1;
  if (/Google US English|Samantha|Microsoft (Aria|Jenny|Zira)/i.test(voice.name)) score += 4;
  return score;
}

function pickEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = 0;
  for (const voice of voices) {
    const score = scoreVoice(voice);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

/** Loads the voice list (and keeps it fresh after `voiceschanged`). Safe to call repeatedly. */
export function primeSynthesis(): void {
  if (voicesBound || !isSynthesisSupported()) return;
  voicesBound = true;
  const refresh = () => {
    preferredVoice = pickEnglishVoice(window.speechSynthesis.getVoices());
  };
  refresh();
  window.speechSynthesis.addEventListener('voiceschanged', refresh);
}

export interface SpeakHandlers {
  onStart?(): void;
  /** Fires once, whether the utterance finished, was cancelled or never started. */
  onEnd?(): void;
}

/** Chrome cuts long utterances off after ~15 s, so split on sentence boundaries into short chunks. */
function chunkForSpeech(text: string, max = 200): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    if (current && current.length + sentence.length + 1 > max) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

const START_WATCHDOG_MS = 8_000;

// The finisher of the utterance in flight. Holding it here also keeps the utterances it closes over reachable:
// Chrome garbage-collects in-flight utterances (and drops their `onend`) unless something references them.
let currentFinish: (() => void) | null = null;

/** Speaks `text` with the preferred English voice, cancelling anything still playing. Returns false if unsupported. */
export function speak(text: string, handlers: SpeakHandlers = {}): boolean {
  if (!isSynthesisSupported()) return false;
  const chunks = chunkForSpeech(text);
  if (chunks.length === 0) return false;
  primeSynthesis();
  stopSpeaking();

  const synth = window.speechSynthesis;
  let started = false;
  let finished = false;
  let watchdog = 0;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(watchdog);
    for (const utterance of utterances) {
      utterance.onstart = null;
      utterance.onend = null;
      utterance.onerror = null;
    }
    if (currentFinish === finish) currentFinish = null;
    handlers.onEnd?.();
  };

  const utterances = chunks.map((chunk, index) => {
    const utterance = new SpeechSynthesisUtterance(chunk);
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.lang = preferredVoice?.lang ?? 'en-US';
    utterance.rate = 0.95;
    utterance.onstart = () => {
      if (started) return;
      started = true;
      window.clearTimeout(watchdog);
      handlers.onStart?.();
    };
    if (index === chunks.length - 1) utterance.onend = finish;
    utterance.onerror = finish;
    return utterance;
  });

  currentFinish = finish;
  // If the browser never starts playing (blocked audio, a dropped queue after cancel()), give up quietly.
  watchdog = window.setTimeout(() => {
    if (started) return;
    if (synth.speaking || synth.pending) synth.cancel();
    finish();
  }, START_WATCHDOG_MS);
  for (const utterance of utterances) synth.speak(utterance);
  return true;
}

/** Cancels the current utterance (its `onEnd` still fires). */
export function stopSpeaking(): void {
  if (!isSynthesisSupported()) return;
  const finish = currentFinish;
  currentFinish = null;
  const synth = window.speechSynthesis;
  if (synth.speaking || synth.pending) synth.cancel();
  finish?.();
}

// --- mute preference -----------------------------------------------------------------------------

const MUTE_KEY = 'carecompanion.muted';

export function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); the toggle still works for the session.
  }
}
