import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { desktop, isIOS, isTauri } from '../platform';
import { takeCue, type DisplayCue } from '../lib/lyricsCue';
import { WORDS_START, facesAt, loadDisplayDelay, type WordsState } from '../lib/lyricsDisplay';
import { catchUpCues, leaveCue, monitorChoices, monitorLabel, oneAtATime, scheduleCue, syncDisplay, wordsStartAt, type MonitorInfo } from '../lib/lyricsWindow';
import { SlideScreen } from './LyricsPanel';

const canDisplay = isTauri() && !isIOS();

/**
 * The lyrics window (index.html?window=lyrics): the words on the whole screen, driven only by the cues Perform sends.
 * No key closes it from the page. ⌘W, the Window menu's Close, does when this window has the keyboard, which it keeps
 * only when it fills the screen Perform is on. The Display button on Perform always can.
 */
export function LyricsWindow() {
  const [faces, setFaces] = useState(WORDS_START.faces);
  useEffect(() => {
    let display = WORDS_START.display;
    let shown = WORDS_START.faces;
    let frame = 0;
    const stop = desktop.joinLyricsCues(cues => {
      display = cues.reduce((held, cue) => takeCue(held, cue, Date.now()), display);
    });
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const next = facesAt(shown, display, Date.now());
      if (next.up !== shown.up || next.was !== shown.was || next.p !== shown.p) setFaces((shown = next));
    };
    frame = requestAnimationFrame(loop);
    // Handled here, so Esc doesn't go on to macOS and take the window out of fullscreen.
    const swallow = (event: KeyboardEvent) => {
      if (!event.metaKey) event.preventDefault();
    };
    window.addEventListener('keydown', swallow);
    return () => {
      stop();
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', swallow);
    };
  }, []);
  // The two sizes match on a 16:9 screen. On any other shape, the words stay the size they'd be in the 16:9 that fits.
  return (
    <div className="fixed inset-0 cursor-none overflow-hidden bg-black">
      <SlideScreen faces={faces} className="h-full w-full !ring-0 ![container-type:size]" textClass="text-[min(4.5cqw,8cqh)]" />
    </div>
  );
}

let lastSeq = 0;

/** A new strip's state. Its cues count on from above anything an open window has taken, even across a reload. */
export const freshWords = () => wordsStartAt(Math.max(Date.now(), lastSeq + 1));

/** Sends the lyrics window cues, with the display delay on any still to come. Read each time, so a change applies to the next cue. */
export function sendCues(cues: DisplayCue[], ms: number) {
  if (!canDisplay || !cues.length) return;
  const delay = loadDisplayDelay();
  desktop.sendLyricsCues(cues.map(cue => scheduleCue(cue, delay, ms)));
}

export interface DisplayLink {
  available: boolean;
  monitors: MonitorInfo[];
  /** The screen the lyrics window was opened on. Null when it isn't open. */
  on: string | null;
  error: string | null;
  open(monitor: string): Promise<void>;
  close(): Promise<void>;
  refresh(): Promise<void>;
}

/**
 * The Words strip's hold on the lyrics window, kept above its layouts so it lasts from song to song. `tick` runs on a
 * timer too: Perform's frames stop while its window is hidden or covered, and the room's screen still needs its cues.
 */
export function useDisplayLink(holder: MutableRefObject<WordsState>, tick: () => void): DisplayLink {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [on, setOn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = useRef<string | null>(null);
  const [inTurn] = useState(oneAtATime);
  const latestTick = useRef(tick);
  latestTick.current = tick;

  const choose = (screen: string | null) => {
    chosen.current = screen;
    setOn(screen);
  };
  const sync = async () => {
    const seen = await Promise.all([desktop.listMonitors(), desktop.lyricsDisplayMonitor()]).catch(() => null);
    if (!seen) return;
    const [list, where] = seen;
    setMonitors(list);
    const next = syncDisplay(chosen.current, where, list);
    choose(next.chosen);
    if (next.close) await desktop.closeLyricsDisplay().catch(() => {});
  };
  const refresh = () => inTurn(sync);
  const close = () =>
    inTurn(async () => {
      await desktop.closeLyricsDisplay().catch(() => setError('Could not close the display.'));
      await sync();
    });
  const open = (monitor: string) =>
    inTurn(async () => {
      setError(null);
      try {
        choose(await desktop.openLyricsDisplay(monitor));
      } catch {
        setError('Could not open that display.');
      }
    });

  useEffect(() => {
    if (!canDisplay) return;
    void refresh();
    const stops = [desktop.onLyricsDisplayClosed(() => void refresh()), desktop.onLyricsDisplayReady(() => sendCues(catchUpCues(holder.current.display), Date.now()))];
    const polling = setInterval(() => void refresh(), 2000);
    const ticking = setInterval(() => latestTick.current(), 250);
    return () => {
      stops.forEach(stop => stop());
      clearInterval(polling);
      clearInterval(ticking);
      const ms = Date.now();
      const left = leaveCue(holder.current, ms);
      holder.current = left.state;
      lastSeq = left.cue.seq;
      sendCues([left.cue], ms);
    };
  }, []);

  return { available: canDisplay, monitors, on, error, open, close, refresh };
}

/** Display on the Words strip: pick a screen, see which one it's on, move it or turn it off. */
export function DisplayButton({ link, className }: { link: DisplayLink; className: string }) {
  const [picking, setPicking] = useState(false);
  if (!link.available) {
    return (
      <button type="button" disabled title={isIOS() ? 'Coming in a later step' : 'Only in the Mac app'} className={className}>
        Display
      </button>
    );
  }
  const current = link.monitors.find(monitor => monitor.id === link.on);
  const choices = monitorChoices(link.monitors);
  const pick = (monitor: string) => () => {
    setPicking(false);
    if (monitor !== link.on) void link.open(monitor);
  };
  return (
    <div className="relative grid">
      <button
        type="button"
        aria-expanded={picking}
        className={className}
        onClick={() => {
          void link.refresh();
          setPicking(!picking);
        }}
      >
        {current ? `On ${monitorLabel(current, link.monitors)}` : 'Display'}
      </button>
      {!picking && link.error && (
        <p className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap text-sm font-semibold text-amber" role="alert">
          {link.error}
        </p>
      )}
      {picking && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setPicking(false)} aria-hidden />
          <div className="absolute bottom-full right-0 z-20 mb-2 w-72 rounded-2xl border border-edge bg-panel p-2 shadow-2xl shadow-navy/15 dark:shadow-black/60" role="group" aria-label="Show the words on">
            <p className="caps px-3 py-1.5 text-muted">Show the words on</p>
            {choices.map((monitor, k) => {
              const here = monitor.id === link.on;
              return (
                <button key={monitor.id} type="button" aria-pressed={here} className={`block w-full rounded-xl px-3 py-2.5 text-left hover:bg-raised ${here || (!link.on && k === 0) ? 'bg-accent-soft' : ''}`} onClick={pick(monitor.id)}>
                  <span className={`block font-medium ${here ? 'text-amber' : ''}`}>{monitorLabel(monitor, link.monitors)}</span>
                  <span className="tabular block text-sm text-muted">
                    {monitor.width} × {monitor.height}
                  </span>
                </button>
              );
            })}
            {choices.length === 1 && !link.on && <p className="px-3 py-1.5 text-sm text-muted">This takes over the only screen. Press ⌘W to come back.</p>}
            {link.on && (
              <button
                type="button"
                className="mt-1 block w-full rounded-xl border-t border-line px-3 py-2.5 text-left hover:bg-raised"
                onClick={() => {
                  setPicking(false);
                  void link.close();
                }}
              >
                Turn off
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
