/**
 * Page shell of the simulated Alexa+ experience: a top bar (product name, persona toggle, Demo menu), the elder
 * device pane and the caregiver dashboard pane side by side from 1024 px (tabs below that), and the demo footer.
 *
 * State that crosses panes lives here: the speaker persona, the transcript (the last 6 turns go back to the agent
 * as history), the acting caregiver, and the dashboard data (polled, and refreshed after every agent reply).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { AgentStatus, Speaker } from '@shared/agent';
import { AlexaDevice, type DevicePhase } from './components/AlexaDevice';
import { DemoMenu } from './components/DemoMenu';
import { PushToTalk } from './components/PushToTalk';
import { Transcript, type TranscriptTurn } from './components/Transcript';
import { ApiError, askAgent, describeError, getAgentStatus, type DemoStatus } from './lib/api';
import { isSynthesisSupported, primeSynthesis, readMuted, speak, stopSpeaking, writeMuted } from './lib/speech';
import { brainLabel, newId, stripWakeWord } from './lib/text';
import { useDashboard } from './lib/useDashboard';
import { DashboardPanel } from './pages/DashboardPanel';

const HISTORY_TURNS = 6;
const DEFAULT_CAREGIVER_ID = 'cg_priya';

type Pane = 'elder' | 'caregiver';

const PANES: Array<{ id: Pane; label: string }> = [
  { id: 'elder', label: 'Elder device' },
  { id: 'caregiver', label: 'Caregiver dashboard' },
];

function PersonaButton({ active, onClick, children }: { active: boolean; onClick(): void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
        active ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

function PaneHeading({ id, title, subtitle }: { id: string; title: string; subtitle: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="text-lg font-semibold text-slate-900">
        {title}
      </h2>
      <p className="truncate text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

export function App() {
  const [speaker, setSpeaker] = useState<Speaker>('elder');
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [caregiverId, setCaregiverId] = useState(DEFAULT_CAREGIVER_ID);
  const dashboard = useDashboard();

  const [phase, setPhase] = useState<DevicePhase>('idle');
  const [interim, setInterim] = useState('');
  const [reply, setReply] = useState<string | null>(null);
  const [emergency, setEmergency] = useState<string | null>(null);
  const [muted, setMuted] = useState(readMuted);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [pane, setPane] = useState<Pane>('elder');
  const [notice, setNotice] = useState<string | null>(null);

  const turnsRef = useRef(turns);
  const mutedRef = useRef(muted);
  const busyRef = useRef(false);
  const synthesisSupported = useMemo(() => isSynthesisSupported(), []);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const refreshAgentStatus = useCallback(async () => {
    try {
      setAgentStatus(await getAgentStatus());
    } catch {
      // Informational only (brain badge); the conversation works without it.
    }
  }, []);

  useEffect(() => {
    primeSynthesis();
    void refreshAgentStatus();
  }, [refreshAgentStatus]);

  const { refresh: refreshDashboard } = dashboard;
  const elderName = dashboard.data?.elder.preferredName ?? 'Eleanor';
  const caregiverName = dashboard.data?.caregivers.find((c) => c.id === caregiverId)?.name ?? 'Priya Whitfield-Singh';
  const caregiverFirstName = caregiverName.split(' ')[0] ?? caregiverName;

  const run = useCallback(
    async (utterance: string) => {
      busyRef.current = true;
      stopSpeaking();
      setEmergency(null);
      setInterim('');
      const history = turnsRef.current
        .filter((turn) => !turn.failed)
        .slice(-HISTORY_TURNS)
        .map(({ role, text }) => ({ role, text }));
      setTurns((prev) => [
        ...prev,
        {
          id: newId(),
          role: 'user',
          text: utterance,
          at: new Date().toISOString(),
          speakerLabel: speaker === 'elder' ? elderName : caregiverFirstName,
        },
      ]);
      setPhase('thinking');
      try {
        const response = await askAgent({ utterance, speaker, history });
        setTurns((prev) => [
          ...prev,
          { id: newId(), role: 'assistant', text: response.reply, at: new Date().toISOString(), response },
        ]);
        setReply(response.reply);
        // The reply already contains any emergency guidance, so it is spoken once, as part of the reply.
        setEmergency(response.emergencyGuidance ?? null);
        void refreshDashboard();
        void refreshAgentStatus();
        const speaking =
          !mutedRef.current &&
          speak(response.reply, { onEnd: () => setPhase((current) => (current === 'speaking' ? 'idle' : current)) });
        setPhase(speaking ? 'speaking' : 'idle');
      } catch (err) {
        const text =
          err instanceof ApiError && err.isRateLimited
            ? `I'm getting a lot of requests right now — please try again in ${err.retryAfterSec ?? 60} seconds.`
            : `Sorry, I couldn't complete that. ${describeError(err)}`;
        setTurns((prev) => [
          ...prev,
          { id: newId(), role: 'assistant', text, at: new Date().toISOString(), failed: true },
        ]);
        setReply(text);
        setPhase('idle');
      } finally {
        busyRef.current = false;
      }
    },
    [speaker, elderName, caregiverFirstName, refreshDashboard, refreshAgentStatus]
  );

  /** Strips the wake word and starts a turn. Returns false when nothing was left to send. */
  const send = useCallback(
    (raw: string): boolean => {
      const utterance = stripWakeWord(raw);
      if (!utterance) return false;
      if (!busyRef.current) void run(utterance);
      return true;
    },
    [run]
  );

  const onListeningChange = useCallback((listening: boolean) => {
    setPhase((current) => (listening ? 'listening' : current === 'listening' ? 'idle' : current));
  }, []);

  const onBeforeListen = useCallback(() => stopSpeaking(), []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    writeMuted(next);
    if (next) stopSpeaking();
  };

  const onDemoReset = useCallback(
    (status: DemoStatus) => {
      stopSpeaking();
      setTurns([]);
      setReply(null);
      setEmergency(null);
      setInterim('');
      setPhase('idle');
      void refreshDashboard();
      void refreshAgentStatus();
      setNotice(
        `Demo reset — scenario "${status.scenario}", household clock ${status.localTime} (${status.timezone}).`
      );
    },
    [refreshDashboard, refreshAgentStatus]
  );

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next: Pane = pane === 'elder' ? 'caregiver' : 'elder';
    setPane(next);
    document.getElementById(`${next}-tab`)?.focus();
  };

  const busy = phase === 'thinking';
  const hint =
    speaker === 'elder'
      ? `Hello ${elderName}. Say "Alexa, what's my plan today?" or press the microphone.`
      : `Caregiver mode. Ask "How is Mom doing this week?" or press the microphone.`;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <div className="mr-auto">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">CareCompanion</h1>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              simulated Alexa+ experience
            </p>
          </div>
          <div
            role="group"
            aria-label="Who is speaking"
            className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm"
          >
            <PersonaButton active={speaker === 'elder'} onClick={() => setSpeaker('elder')}>
              {`Elder · ${elderName}`}
            </PersonaButton>
            <PersonaButton active={speaker === 'caregiver'} onClick={() => setSpeaker('caregiver')}>
              {`Caregiver · ${caregiverFirstName}`}
            </PersonaButton>
          </div>
          {agentStatus && (
            <span
              className="hidden rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 sm:inline"
              title={`Model ${agentStatus.model} in ${agentStatus.region}`}
            >
              {brainLabel(agentStatus.brain, agentStatus.model)}
              {agentStatus.bedrockPaused ? ' · paused' : ''}
            </span>
          )}
          <DemoMenu agentStatus={agentStatus} onReset={onDemoReset} />
        </div>
      </header>

      {notice && (
        <div role="status" className="mx-auto mt-4 flex w-full max-w-[1600px] items-center gap-3 px-4">
          <p className="flex-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {notice}
          </p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          >
            Dismiss
          </button>
        </div>
      )}

      <div role="tablist" aria-label="Panes" className="mx-auto mt-4 flex w-full max-w-[1600px] gap-2 px-4 lg:hidden">
        {PANES.map((tab) => (
          <button
            key={tab.id}
            id={`${tab.id}-tab`}
            type="button"
            role="tab"
            aria-selected={pane === tab.id}
            aria-controls={`${tab.id}-pane`}
            tabIndex={pane === tab.id ? 0 : -1}
            onClick={() => setPane(tab.id)}
            onKeyDown={onTabKeyDown}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
              pane === tab.id
                ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]">
          <section
            id="elder-pane"
            role="tabpanel"
            aria-labelledby="elder-pane-title"
            className={`space-y-4 ${pane === 'elder' ? '' : 'hidden lg:block'}`}
          >
            <PaneHeading
              id="elder-pane-title"
              title="Elder device"
              subtitle={
                speaker === 'elder' ? `${elderName}'s kitchen Echo Show` : `${caregiverFirstName} talking to Alexa+`
              }
            />
            <AlexaDevice
              phase={phase}
              interimText={interim}
              reply={reply}
              emergencyGuidance={emergency}
              hint={hint}
              clock={dashboard.data?.localTime ?? null}
              muted={muted}
              synthesisSupported={synthesisSupported}
              onToggleMute={toggleMute}
            />
            <PushToTalk
              busy={busy}
              speaker={speaker}
              onListeningChange={onListeningChange}
              onInterim={setInterim}
              onUtterance={send}
              onBeforeListen={onBeforeListen}
            />
            <Transcript turns={turns} modelId={agentStatus?.model} />
          </section>

          <section
            id="caregiver-pane"
            role="tabpanel"
            aria-labelledby="caregiver-pane-title"
            className={`space-y-4 ${pane === 'caregiver' ? '' : 'hidden lg:block'}`}
          >
            <PaneHeading
              id="caregiver-pane-title"
              title="Caregiver dashboard"
              subtitle="What the family sees — the same view Alexa+ renders as an MCP App"
            />
            <DashboardPanel dashboard={dashboard} caregiverId={caregiverId} onCaregiverChange={setCaregiverId} />
          </section>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-3 text-center text-sm text-slate-500">
        Demo data — not real patients. Caregiver notifications are simulated.
      </footer>
    </div>
  );
}
