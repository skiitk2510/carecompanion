/**
 * Voice input for the simulated device: a large round microphone button (press to listen, press again or go quiet
 * to stop) backed by the Web Speech API, with a text box + Send button as the always-available fallback.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Speaker } from '@shared/agent';
import { isRecognitionSupported, startRecognition, type RecognitionSession } from '../lib/speech';
import { MicIcon, StopIcon } from './icons';

interface PushToTalkProps {
  /** A request is in flight: sending is paused until the reply arrives. */
  busy: boolean;
  speaker: Speaker;
  onListeningChange(listening: boolean): void;
  onInterim(text: string): void;
  /** Returns false when the utterance was empty after wake-word stripping (nothing was sent). */
  onUtterance(text: string): boolean;
  /** Called right before the microphone opens (the app uses it to cancel any spoken reply). */
  onBeforeListen?(): void;
}

const SUGGESTIONS: Record<Speaker, string[]> = {
  elder: [
    "Alexa, what's my plan today?",
    'I took my blood pressure pill, the lisinopril',
    "I'm feeling a bit dizzy this morning",
    'Help, I fell in the kitchen',
  ],
  caregiver: ['How is Mom doing this week?', 'Give me the 30-day summary', 'What does Mom take today?'],
};

export function PushToTalk({
  busy,
  speaker,
  onListeningChange,
  onInterim,
  onUtterance,
  onBeforeListen,
}: PushToTalkProps) {
  const supported = useMemo(() => isRecognitionSupported(), []);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState('');
  const sessionRef = useRef<RecognitionSession | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => sessionRef.current?.abort(), []);

  const deliver = (utterance: string) => {
    if (!onUtterance(utterance))
      setNotice('Say what you need after "Alexa" — for example "Alexa, what\'s my plan today?"');
  };

  const toggleListening = () => {
    if (sessionRef.current) {
      sessionRef.current.stop();
      return;
    }
    onBeforeListen?.();
    setNotice(null);
    const session = startRecognition({
      onInterim,
      onEnd: () => {
        sessionRef.current = null;
        setListening(false);
        onListeningChange(false);
        onInterim('');
      },
      onFinal: deliver,
      onError: (message) => setNotice(message),
    });
    if (!session) return;
    sessionRef.current = session;
    setListening(true);
    onListeningChange(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const utterance = text.trim();
    if (!utterance || busy) return;
    setNotice(null);
    setText('');
    deliver(utterance);
    inputRef.current?.focus();
  };

  const suggest = (utterance: string) => {
    if (busy) return;
    setNotice(null);
    deliver(utterance);
  };

  return (
    <div className="space-y-3">
      {!supported && (
        <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Voice input isn't available in this browser — type instead (Chrome supports voice)
        </p>
      )}

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={toggleListening}
          disabled={!supported || (busy && !listening)}
          aria-pressed={listening}
          aria-label={listening ? 'Stop listening' : 'Start listening'}
          className={`inline-flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-white shadow-lg transition focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-40 ${
            listening ? 'bg-rose-600 hover:bg-rose-500 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-500'
          }`}
        >
          {listening ? <StopIcon className="h-9 w-9" /> : <MicIcon className="h-9 w-9" />}
        </button>
        <div className="min-w-0 text-sm text-slate-600">
          <p className="text-base font-semibold text-slate-800">
            {listening ? 'Listening… press again to stop' : busy ? 'One moment…' : 'Press to talk'}
          </p>
          <p>Say "Alexa, …" or just speak — the wake word is stripped before sending.</p>
          {notice && (
            <p role="status" className="mt-1 font-medium text-rose-700">
              {notice}
            </p>
          )}
        </div>
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="utterance" className="sr-only">
          Type what you would say to Alexa
        </label>
        <input
          ref={inputRef}
          id="utterance"
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Or type: what's my plan today?"
          autoComplete="off"
          disabled={busy}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100"
        />
        <button
          type="submit"
          disabled={busy || text.trim().length === 0}
          className="rounded-lg bg-slate-900 px-4 py-2.5 text-base font-semibold text-white shadow-sm transition hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2" aria-label="Suggested things to say">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Try</span>
        {SUGGESTIONS[speaker].map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => suggest(suggestion)}
            disabled={busy}
            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 transition hover:border-indigo-400 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-40"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
