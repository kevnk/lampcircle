import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Song } from '../types';
import { Stepper, beatsLabel } from '../ui';
import { now, type PerformSession } from '../audio/engine';
import { lyricsCue, type LyricsPrefs } from '../lib/lyricsCue';
import { FADE_BEATS, LEAD_BEATS, WORDS_START, beatsToChange, hasWords, loadLyricsPrefs, saveLyricsPrefs, slidesToOffer, tapSlide, tickWords, toggleScreen, type ScreenMode } from '../lib/lyricsDisplay';
import { SlideScreen } from './LyricsPanel';

/**
 * The Words strip on Perform: what the room's screen shows, the next slide and the beats until it, and Blank and Logo.
 * Perform renders every frame, and each commit moves the cues on, so they follow the real fades and freeze on pause.
 */
export function WordsStrip({ session, song }: { session: PerformSession; song: Song | undefined }) {
  const [prefs, setPrefs] = useState(loadLyricsPrefs);
  const [timing, setTiming] = useState(false);
  const holder = useRef(WORDS_START);
  const snap = session.snapshot();
  const ctxNow = now();
  const ms = performance.timeOrigin + performance.now();
  const ps = session.ps;
  const cue = lyricsCue(snap, ps, ctxNow, prefs);
  useEffect(() => {
    holder.current = tickWords(holder.current, cue, { ctxNow, ms }).state;
  });

  const words = holder.current;
  const change = (patch: Partial<LyricsPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveLyricsPrefs(next);
  };
  const hold = (mode: Exclude<ScreenMode, 'words'>) => () => void (holder.current = toggleScreen(holder.current, mode));
  const show = (lines: string[]) => () => void (holder.current = tapSlide(holder.current, lines));

  const controls = (quiet = false) => {
    const button = (on = false) =>
      `rounded-full border ${quiet ? 'px-3 py-1.5 text-sm' : 'min-h-11 px-4 py-2 font-medium ios:!min-h-14 ios:rounded-2xl'} ${on ? 'border-accent bg-accent-soft font-semibold text-amber' : 'border-edge hover:bg-raised disabled:cursor-not-allowed disabled:border-line disabled:text-faint disabled:hover:bg-transparent'}`;
    return (
      <div className={quiet ? 'ml-auto flex gap-2' : 'grid w-full grid-cols-3 gap-3 sm:ml-auto sm:flex sm:w-auto'} role="group" aria-label="The screen">
        <button type="button" aria-pressed={words.mode === 'blank'} className={button(words.mode === 'blank')} onClick={hold('blank')}>
          Blank
        </button>
        <button type="button" aria-pressed={words.mode === 'logo'} className={button(words.mode === 'logo')} onClick={hold('logo')}>
          Logo
        </button>
        <button type="button" disabled title="Coming in a later step" className={button()}>
          Display
        </button>
      </div>
    );
  };
  const own = (ps?.song ?? song)?.lyrics;
  const ownNames = [own?.leadBeats !== undefined && 'lead', own?.fadeBeats !== undefined && 'fade'].filter(Boolean).join(' and ');
  const timingPanel = (
    <>
      <button type="button" className="flex items-center gap-1.5 rounded-full px-2 py-1 text-sm text-muted hover:text-ink" aria-expanded={timing} onClick={() => setTiming(!timing)}>
        Timing <ChevronDown className={`h-4 w-4 ${timing ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {timing && (
        <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-3">
          <div className="flex items-center gap-3">
            <span>Lead</span>
            <Stepper name="lead" label={beatsLabel(prefs.leadBeats)} value={prefs.leadBeats} {...LEAD_BEATS} onChange={leadBeats => change({ leadBeats })} />
          </div>
          <div className="flex items-center gap-3">
            <span>Fade</span>
            <Stepper name="fade" label={beatsLabel(prefs.fadeBeats)} value={prefs.fadeBeats} {...FADE_BEATS} onChange={fadeBeats => change({ fadeBeats })} />
          </div>
          <p className="w-full text-sm text-muted">
            How early a slide comes in and how long it dissolves, for every song that doesn't set its own.
            {ownNames && ` This song sets its own ${ownNames}.`}
          </p>
        </div>
      )}
    </>
  );

  if (cue.idle) {
    const wordless = snap.song && ps ? true : song ? !hasWords(song) : false;
    return (
      <section className="mt-5 rounded-2xl border border-line px-4 py-3" aria-label="Words">
        <div className="flex flex-wrap items-center gap-3">
          {(!wordless || words.mode !== 'words') && <SlideScreen faces={words.faces} className="aspect-video w-16 rounded-md" />}
          <p className="text-muted">{wordless ? 'No words' : song ? 'Waiting to start' : 'Between songs'}</p>
          {controls(wordless)}
        </div>
        {!wordless && timingPanel}
      </section>
    );
  }

  const offer = slidesToOffer(words, cue);
  const beats = snap.song && ps ? beatsToChange(cue, ps.grid, snap.song.pos, ctxNow) : null;
  const held = words.mode === 'blank' ? 'The screen is black.' : words.mode === 'logo' ? 'The screen shows the logo.' : null;
  return (
    <section className="mt-5 rounded-2xl border border-line bg-panel p-4 ios:max-md:p-3" aria-label="Words">
      <div className="mb-3 flex min-h-6 items-baseline justify-between gap-3">
        <p className="caps text-muted">On the screen</p>
        {held && (
          <p className="text-sm font-semibold text-amber" role="status">
            {held}
          </p>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <SlideScreen faces={words.faces} className="aspect-[2/1] rounded-xl" textClass="text-[clamp(1.25rem,5.5cqw,2.5rem)]" />
        <div className="flex min-w-0 flex-col gap-3">
          {offer.current && <SlideRow label="Current" lines={offer.current} onTap={show(offer.current)} />}
          {offer.next ? (
            <SlideRow label="Next" lines={offer.next} onTap={show(offer.next)} count={beats === null ? undefined : `in ${beats} beat${beats === 1 ? '' : 's'}`} />
          ) : (
            <p className="rounded-xl border border-line px-3 py-2.5 text-muted">{snap.paused ? 'Paused' : cue.next ? 'The next slide has the same words.' : 'Last slide'}</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">{controls()}</div>
      <div className="mt-2">{timingPanel}</div>
    </section>
  );
}

/** A slide beside the screen, dim until it is up. Tapping it shows it now. */
function SlideRow({ label, lines, count, onTap }: { label: string; lines: string[]; count?: string; onTap: () => void }) {
  return (
    <button type="button" className="min-h-14 w-full rounded-xl border border-line px-3 py-2.5 text-left hover:border-edge" aria-label={`Show now: ${lines.join(' / ') || 'a blank slide'}`} onClick={onTap}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="caps text-muted">{label}</span>
        {count && <span className="tabular text-lg font-bold text-amber">{count}</span>}
      </span>
      {lines.length ? (
        lines.map((line, k) => (
          <span key={k} className="block leading-snug text-muted">
            {line}
          </span>
        ))
      ) : (
        <span className="block italic text-muted">Blank</span>
      )}
    </button>
  );
}
