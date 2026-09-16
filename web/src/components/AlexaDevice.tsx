/**
 * An Echo-Show-style device frame: a dark bezel around a "screen" that shows the latest reply in large type, a
 * listening / thinking / speaking indicator ring, an Alexa-style light bar, and the mute toggle for spoken replies.
 */
import type { ReactNode } from 'react';
import { SpeakerIcon, SpeakerOffIcon } from './icons';

export type DevicePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

interface AlexaDeviceProps {
  phase: DevicePhase;
  /** Live transcript while listening. */
  interimText: string;
  /** The latest assistant reply (null before the first turn). */
  reply: string | null;
  /** Rendered as a red banner on the screen when a tool returned emergency guidance this turn. */
  emergencyGuidance: string | null;
  /** What to show before the first reply. */
  hint: string;
  /** Household wall-clock time (HH:mm) from the server, so demo clock shifts show on the device. */
  clock: string | null;
  muted: boolean;
  synthesisSupported: boolean;
  onToggleMute(): void;
}

const PHASE_LABEL: Record<DevicePhase, string> = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
};

function StatusRing({ phase }: { phase: DevicePhase }) {
  const ring =
    phase === 'listening'
      ? 'border-cyan-300 shadow-[0_0_24px_rgba(34,211,238,0.7)] animate-pulse'
      : phase === 'thinking'
        ? 'border-indigo-300 border-t-transparent animate-spin'
        : phase === 'speaking'
          ? 'border-emerald-300 shadow-[0_0_20px_rgba(52,211,153,0.6)] animate-pulse'
          : 'border-slate-600';
  const dot =
    phase === 'listening'
      ? 'bg-cyan-300'
      : phase === 'thinking'
        ? 'bg-indigo-300'
        : phase === 'speaking'
          ? 'bg-emerald-300'
          : 'bg-slate-600';
  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      <span className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full border-4 ${ring}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      </span>
      <span className="text-sm text-slate-300">{PHASE_LABEL[phase]}</span>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1.5 align-middle" aria-hidden="true">
      <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-indigo-300 [animation-delay:-0.3s]" />
      <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-indigo-300 [animation-delay:-0.15s]" />
      <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-indigo-300" />
    </span>
  );
}

export function AlexaDevice({
  phase,
  interimText,
  reply,
  emergencyGuidance,
  hint,
  clock,
  muted,
  synthesisSupported,
  onToggleMute,
}: AlexaDeviceProps) {
  const lightBar =
    phase === 'listening'
      ? 'bg-cyan-400 shadow-[0_0_18px_rgba(34,211,238,0.9)]'
      : phase === 'thinking'
        ? 'bg-indigo-400 shadow-[0_0_18px_rgba(129,140,248,0.9)] animate-pulse'
        : phase === 'speaking'
          ? 'bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.9)]'
          : 'bg-slate-700';

  // The reply already contains the guidance; show it once, in the banner, and keep the rest of the reply below.
  const replyBody =
    reply && emergencyGuidance && reply.includes(emergencyGuidance)
      ? reply.replace(emergencyGuidance, '').trim()
      : reply;

  let body: ReactNode = null;
  if (phase === 'listening') {
    body = (
      <div>
        <p className="text-sm font-medium uppercase tracking-widest text-cyan-300">Listening…</p>
        <p className="mt-2 min-h-[3rem] text-2xl leading-relaxed text-white">
          {interimText || <span className="text-slate-400">Go ahead, I'm listening.</span>}
        </p>
      </div>
    );
  } else if (phase === 'thinking') {
    body = (
      <p className="text-2xl leading-relaxed text-slate-200">
        Thinking <ThinkingDots />
      </p>
    );
  } else if (replyBody) {
    body = <p className="text-xl leading-relaxed text-white md:text-2xl">{replyBody}</p>;
  } else if (!emergencyGuidance) {
    body = <p className="text-xl leading-relaxed text-slate-300 md:text-2xl">{hint}</p>;
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="rounded-[2rem] bg-slate-900 p-3 shadow-2xl ring-1 ring-slate-700/60">
        <div className="mb-2 flex items-center justify-between px-3 text-[11px] uppercase tracking-[0.2em] text-slate-500">
          <span>Echo Show · simulated</span>
          <span className="h-1.5 w-1.5 rounded-full bg-slate-600" aria-hidden="true" />
        </div>

        <div className="relative min-h-[21rem] rounded-[1.25rem] bg-gradient-to-br from-slate-800 via-slate-900 to-indigo-950 p-6 text-white">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm tabular-nums text-slate-300" aria-label="Household local time">
              {clock ?? '--:--'}
            </span>
            <StatusRing phase={phase} />
            {synthesisSupported ? (
              <button
                type="button"
                onClick={onToggleMute}
                aria-pressed={muted}
                aria-label={muted ? 'Unmute spoken replies' : 'Mute spoken replies'}
                title={muted ? 'Unmute spoken replies' : 'Mute spoken replies'}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-600 text-slate-300 transition hover:border-slate-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                {muted ? <SpeakerOffIcon className="h-5 w-5" /> : <SpeakerIcon className="h-5 w-5" />}
              </button>
            ) : (
              <span className="text-xs text-slate-400">no speech output</span>
            )}
          </div>

          <div className="mt-6" aria-live="polite" aria-atomic="true">
            {emergencyGuidance && (
              <div
                role="alert"
                className="mb-4 rounded-xl border-2 border-rose-300 bg-rose-600 px-4 py-3 text-lg font-semibold leading-snug text-white shadow-lg"
              >
                {emergencyGuidance}
              </div>
            )}
            {body}
          </div>
        </div>

        <div className={`mx-6 mt-3 h-1.5 rounded-full transition-all duration-300 ${lightBar}`} aria-hidden="true" />
      </div>
    </div>
  );
}
