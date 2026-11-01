import { useEffect, useRef, useState } from 'react';
import { Button, LinkButton } from '../ui';
import { audio, now, playClicks, reportedLatency, sinceEvent, transport } from '../audio/engine';
import { isIOS } from '../platform';
import { COUNT_IN, LISTEN_ON, SCORED, checkTaps, clickTimes, outputMoved, saveTapPrefs, type TapCheck, type TapPrefs } from '../lib/tapCalibration';

const ios = isIOS();

/** The song and the check share this pad, so a press takes the same path in both and the check measures what the song will get. */
export function TapPad({ flash, disabled, hint, onTap }: { flash: boolean; disabled?: boolean; hint: string; onTap: (shift: boolean, stamp: number) => void }) {
  return (
    <button
      type="button"
      className={`w-full rounded-2xl border-2 px-3 py-7 text-center transition ${flash ? 'border-accent bg-accent-soft shadow-glow' : 'border-accent/40 bg-well hover:border-accent/70'} ios:py-12`}
      // A touch counts as it lands, not when the finger lifts.
      onClick={ios ? undefined : event => onTap(event.shiftKey, event.timeStamp)}
      onPointerDown={ios ? event => onTap(false, event.timeStamp) : undefined}
      disabled={disabled}
    >
      <span className="block pl-[0.3em] text-4xl font-black tracking-[0.3em] text-amber">TAP</span>
      <span className="mt-3 block whitespace-nowrap text-[13px] text-muted">{hint}</span>
    </button>
  );
}

const signed = (ms: number) => `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${Math.abs(ms)} ms`;

const PROBLEMS = {
  few: 'Too few taps lined up with the clicks.',
  uneven: 'Those taps were too uneven to trust.',
  late: 'The taps ran on past the last click. If you stopped on the high click, the sound is reaching you too late to measure, as AirPlay can. Try built-in speakers or wired headphones.',
};

function saying(result: TapCheck): string {
  if (!result.ok) return `${PROBLEMS[result.why]} Nothing changed.`;
  const size = Math.abs(result.offsetMs);
  if (size === 0) return 'Your taps land right on the clicks, so new taps stay where you press them.';
  return result.offsetMs > 0 ? `Your taps land ${size} ms late here, so new taps move back by that much.` : `Your taps land ${size} ms early here, so new taps move forward by that much.`;
}

/** Stands over the page while clicks play. A flash answers each press, but nothing on screen keeps time with the clicks, so this measures the ears and not the eyes. */
function CheckDialog({ onSaved, onClose }: { onSaved: (prefs: TapPrefs) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [first, setFirst] = useState<number | null>(null);
  const [result, setResult] = useState<TapCheck | null>(null);
  const [flash, setFlash] = useState(false);
  const presses = useRef<number[]>([]);
  const stopRun = useRef(() => {});
  const starting = useRef(false);
  const running = first !== null;
  const close = () => dialog.current?.close();

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    return () => stopRun.current();
  }, []);

  const press = (stamp: number) => {
    presses.current.push(now() - reportedLatency() - sinceEvent(stamp));
    setFlash(true);
    window.setTimeout(() => setFlash(false), 90);
  };

  useEffect(() => {
    if (!running) return;
    const listen = (event: KeyboardEvent) => {
      if (event.key !== ' ') return;
      event.preventDefault();
      if (!event.repeat) press(event.timeStamp);
    };
    window.addEventListener('keydown', listen);
    return () => window.removeEventListener('keydown', listen);
  }, [running]);

  const start = async () => {
    // Audio can be slow to wake on a phone. A second press meanwhile must not start a second run of clicks.
    if (starting.current) return;
    starting.current = true;
    transport.pause();
    setResult(null);
    // Clicks scheduled before the clock runs would all fall at once.
    await audio().ctx.resume();
    starting.current = false;
    if (!dialog.current?.open) return;
    const clicks = clickTimes(now() + 0.5);
    const stopClicks = playClicks(clicks);
    presses.current = [];
    const timer = window.setTimeout(() => {
      const checked = checkTaps(clicks.slice(COUNT_IN), presses.current);
      if (checked.ok) onSaved({ offsetMs: checked.offsetMs, latencyMs: Math.round(reportedLatency() * 1000) });
      setFirst(null);
      setResult(checked);
    }, (clicks[clicks.length - 1] - now() + LISTEN_ON) * 1000);
    stopRun.current = () => {
      window.clearTimeout(timer);
      stopClicks();
    };
    setFirst(clicks[0]);
  };

  return (
    <dialog
      ref={dialog}
      // useKeys stands down while this is in the document, so these presses never reach the song.
      aria-modal="true"
      aria-label="Calibrate taps"
      data-first-click={first ?? undefined}
      onClose={onClose}
      className="w-96 max-w-[calc(100vw-2rem)] rounded-2xl border border-edge bg-panel p-5 text-ink shadow-2xl backdrop:bg-navy/60"
    >
      <h2 className="text-xl font-bold">Calibrate taps</h2>
      {running ? (
        <div className="mt-4">
          <TapPad flash={flash} hint={ios ? 'Tap on every click' : 'Space on every click'} onTap={(_, stamp) => press(stamp)} />
          <p className="mt-3 text-sm text-muted">Stop on the high click.</p>
        </div>
      ) : result ? (
        <div className="mt-3" aria-live="polite">
          <p className={result.ok ? '' : 'text-amber'}>{saying(result)}</p>
          {result.ok && (
            <p className="mt-2 text-sm text-muted">
              Used {result.used} of {SCORED} clicks. Your taps varied by about {result.spreadMs} ms.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p>{ios ? 'Tap the pad on each click.' : 'Press Space on each click, or click the pad if that is how you tap songs.'}</p>
          <p className="text-sm text-muted">The clicks play through your current speakers or headphones. The first {COUNT_IN} don't count. Stop on the last one, the high click.</p>
        </div>
      )}
      {/* The main action comes first, so it has the focus when this opens. */}
      <div className="mt-5 flex flex-row-reverse gap-2">
        {result?.ok && (
          <Button tone="primary" onClick={close}>
            Done
          </Button>
        )}
        {!running && (
          <Button tone={result?.ok ? 'outline' : 'primary'} onClick={() => void start()}>
            {result ? 'Try again' : 'Start'}
          </Button>
        )}
        {!result?.ok && <Button onClick={close}>Cancel</Button>}
      </div>
    </dialog>
  );
}

/** The current tap offset on the Tap screen, with the way to measure it again. */
export function TapOffset({ prefs, playing, onChange }: { prefs: TapPrefs; playing: boolean; onChange: (prefs: TapPrefs) => void }) {
  const [open, setOpen] = useState(false);
  const [moved, setMoved] = useState(false);
  const calibrated = prefs.latencyMs !== undefined;
  const link = 'ios:min-h-[44px] ios:min-w-[44px]';

  useEffect(() => {
    if (!playing) return;
    // The browser's figure settles once sound is flowing.
    const timer = window.setTimeout(() => setMoved(outputMoved(prefs, reportedLatency() * 1000)), 1000);
    return () => window.clearTimeout(timer);
  }, [playing, prefs]);

  const change = (next?: TapPrefs) => {
    saveTapPrefs(next);
    setMoved(false);
    onChange(next ?? { offsetMs: 0 });
  };

  return (
    // Enter on these links opens them. Everywhere else on this screen it plays or pauses.
    <div className="mt-4 border-t border-line pt-3 text-sm" onKeyDown={event => event.key === 'Enter' && event.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-x-4">
        <p className="text-muted">
          Tap offset: <span className="tabular text-ink">{calibrated ? signed(prefs.offsetMs) : 'none yet'}</span>
        </p>
        <LinkButton className={link} onClick={() => setOpen(true)}>
          Calibrate taps
        </LinkButton>
        {calibrated && (
          <LinkButton className={link} onClick={() => change()}>
            Reset
          </LinkButton>
        )}
      </div>
      {moved ? (
        <p className="mt-1 text-amber" aria-live="polite">
          The sound output seems to have changed. Calibrate again.
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted">Moves new taps to match your speakers or headphones. Changed either? Calibrate again.</p>
      )}
      {open && <CheckDialog onSaved={change} onClose={() => setOpen(false)} />}
    </div>
  );
}
