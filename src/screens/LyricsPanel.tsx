import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Song } from '../types';
import { Button, Card, beatsLabel } from '../ui';
import { transport } from '../audio/engine';
import { findLyrics, withFoundLyrics } from '../lib/lyricsFetch';
import { lyricsCue, type DisplayCue, type LyricsPrefs } from '../lib/lyricsCue';
import { WORDS_START, loadLyricsPrefs, tickWords, type ScreenFaces } from '../lib/lyricsDisplay';
import { laneSlides, placeAgain, placementOf, placingOf, previewSnapshot } from '../lib/lyricsEdit';
import { sectionViews, songGrid } from '../lib/songMap';
import type { LyricsEdit } from './LyricsLane';

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

const SOURCES: Record<string, string> = {
  'youtube-subs': "Words from the video's captions",
  'youtube-auto': 'Words from YouTube auto captions',
  whisper: 'Words from a transcription',
  manual: 'Words typed in',
};

/**
 * The Lyrics card under the track: where the words came from, Find lyrics and Place again, the nudge, lines per
 * slide, lead and fade, and a preview of the screen. With no `edit` (the phone) it only shows the status and preview.
 */
export function LyricsPanel({ song, edit }: { song: Song; edit: LyricsEdit | null }) {
  const [open, setOpen] = useState(() => Boolean(song.lyrics));
  const [finding, setFinding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [defaults] = useState(loadLyricsPrefs);
  /** A slider being dragged: only its first change is an undo step. */
  const sliding = useRef(false);
  const lyrics = song.lyrics;
  const source = lyrics?.source;
  const slides = laneSlides(song);
  const placement = placementOf(song);
  const placing = placingOf(song);
  const marked = slides.filter(slide => slide.check).length;
  const unplaced = placement?.unplaced.length ?? 0;
  const canFind = edit !== null && sectionViews(song).length > 0 && !finding;
  const canPlace = edit !== null && Boolean(song.timedLyrics?.length && source);
  const status = [
    source ? (SOURCES[source] ?? (source.startsWith('lrclib:') ? 'Words from LRCLIB' : `Words from ${source}`)) : 'No lyrics yet',
    slides.length ? `${count(slides.filter(slide => slide.lines.length).length, 'slide')} in ${count(new Set(slides.map(slide => slide.sectionId)).size, 'section')}` : source ? 'not placed yet' : null,
    marked ? `${marked} to check` : null,
    unplaced ? `${count(unplaced, 'line')} unplaced` : null,
    placement?.offsetEstimated ? 'timing estimated: check the first line' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const onSlide = (change: (latest: Song, value: number) => Song) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    if (edit?.(latest => change(latest, value), !sliding.current)) sliding.current = true;
  };
  const reset = () => (sliding.current = false);
  const letGo = { onPointerDown: reset, onPointerUp: reset, onPointerCancel: reset, onKeyUp: reset, onBlur: reset };
  const find = async () => {
    setFinding(true);
    setNote(null);
    const found = await findLyrics(song);
    setFinding(false);
    if (!found) return setNote('No lyrics found: the video has no captions, and LRCLIB has nothing for this title.');
    setNote(found.note ?? null);
    // A record timed to a recording of another length gets its offset estimated, and Place again keeps doing that.
    const autoOffset = found.kind === 'lrc' && Boolean(found.note);
    edit?.(latest => placeAgain({ ...withFoundLyrics(latest, found), lyricsPlacing: { ...placingOf(latest), autoOffset } }, { offset: 0 })?.song ?? latest);
    setOpen(true);
  };

  return (
    <Card className="mt-6 p-5">
      <button type="button" className="flex w-full items-baseline gap-3 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <h2 className="text-xl font-bold">Lyrics</h2>
        <span className="min-w-0 flex-1 truncate text-sm text-muted">{status}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 self-center transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div className="space-y-5 text-sm">
            {note && <p className="text-amber" role="status">{note}</p>}
            {edit ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button tone={source ? 'outline' : 'primary'} disabled={!canFind} onClick={() => void find()} title={canFind || finding ? 'Looks in the video captions, then LRCLIB, and places what it finds. Undo brings back what was here.' : 'Mark sections first'}>
                    {finding ? 'Finding…' : 'Find lyrics'}
                  </Button>
                  <Button disabled={!canPlace} onClick={() => edit(latest => placeAgain(latest)?.song ?? latest)} title="Places the found lines on the sections again, replacing your slide edits. Undo brings them back.">
                    Place again
                  </Button>
                </div>
                <Slider label="Nudge" value={lyrics?.offset ?? 0} min={-2} max={2} step={0.05} text={`${(lyrics?.offset ?? 0) > 0 ? '+' : ''}${(lyrics?.offset ?? 0).toFixed(2)} s`} disabled={!canPlace} onChange={onSlide((latest, offset) => placeAgain(latest, { offset })?.song ?? latest)} {...letGo}>
                  Moves every line earlier or later, then places them again. For words that come in late or early everywhere.
                </Slider>
                <div>
                  <p className="mb-1.5 font-medium">Lines on a slide</p>
                  <div className="inline-flex rounded-full border border-line p-1" role="group" aria-label="Lines on a slide">
                    {[1, 2, 3, 4].map(count => (
                      <button
                        key={count}
                        type="button"
                        aria-pressed={placing.linesPerSlide === count}
                        disabled={!canPlace}
                        className={`rounded-full px-3.5 py-1 tabular disabled:text-faint ${placing.linesPerSlide === count ? 'bg-accent-soft text-amber ring-1 ring-inset ring-accent/50' : 'text-muted hover:bg-raised hover:text-ink'}`}
                        onClick={() => edit(latest => placeAgain(latest, { linesPerSlide: count })?.song ?? latest)}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>
                <Slider label="Lead" value={lyrics?.leadBeats ?? defaults.leadBeats} min={1} max={3} step={0.5} text={beatsLabel(lyrics?.leadBeats ?? defaults.leadBeats)} disabled={!lyrics} onChange={onSlide((latest, leadBeats) => ({ ...latest, lyrics: { blocks: {}, ...latest.lyrics, leadBeats } }))} {...letGo}>
                  How early a slide comes in before its bar, so the words are up before they're sung.
                </Slider>
                <Slider label="Fade" value={lyrics?.fadeBeats ?? defaults.fadeBeats} min={0} max={2} step={0.5} text={beatsLabel(lyrics?.fadeBeats ?? defaults.fadeBeats)} disabled={!lyrics} onChange={onSlide((latest, fadeBeats) => ({ ...latest, lyrics: { blocks: {}, ...latest.lyrics, fadeBeats } }))} {...letGo}>
                  How long one slide takes to dissolve into the next.
                </Slider>
                <p className="text-muted">
                  In the lane under the sections: click a slide to go to it, double-click to change its words, drag its left edge to move it. Amber marks need a look.
                </p>
              </>
            ) : (
              <p className="text-muted">Lyrics are read-only here. Edit them on your Mac.</p>
            )}
          </div>
          <div>
            <p className="mb-1.5 font-medium">The screen at the playhead</p>
            <LyricsPreview song={song} prefs={defaults} />
          </div>
        </div>
      )}
    </Card>
  );
}

function Slider({ label, text, children, ...input }: { label: string; text: string; children: string; value: number; min: number; max: number; step: number; disabled: boolean } & Pick<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'onPointerDown' | 'onPointerUp' | 'onPointerCancel' | 'onKeyUp' | 'onBlur'>) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="font-medium">{label}</span>
        <span className="tabular text-muted">{text}</span>
      </span>
      <input type="range" className="mt-1 block w-full disabled:opacity-50" {...input} />
      <span className="mt-0.5 block text-xs text-muted">{children}</span>
    </label>
  );
}

/**
 * What the screen shows at the playhead, through the same cues a display gets: the song as if played straight through,
 * each change dissolving over the fade. A seek or pause changes it at once with a short fade, as a late pick does.
 */
function LyricsPreview({ song, prefs }: { song: Song; prefs: LyricsPrefs }) {
  const latest = useRef(song);
  latest.current = song;
  const [faces, setFaces] = useState<ScreenFaces>(WORDS_START.faces);

  useEffect(() => {
    let state = WORDS_START;
    let id = 0;
    let last = 0;
    const loop = (time: number) => {
      id = requestAnimationFrame(loop);
      if (time - last < 33) return;
      last = time;
      const current = latest.current;
      const views = sectionViews(current);
      const ms = performance.now();
      const ctxNow = ms / 1000;
      const cue = lyricsCue(previewSnapshot(views, transport.position(), ctxNow, !transport.playing), { song: current, grid: songGrid(current), views }, ctxNow, prefs);
      // Before the first slide is due there is nothing to keep up: a song starts on a black screen.
      state = tickWords(state, cue.now ? cue : { ...cue, now: [] }, { ctxNow, ms }).state;
      const next = state.faces;
      setFaces(prev => (prev.up === next.up && prev.was === next.was && prev.p === next.p ? prev : next));
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [prefs]);

  return <SlideScreen faces={faces} className="aspect-video w-full rounded-xl" />;
}

/** A screen: white words on black, or the logo on its dark ground, each change dissolving over its fade. The words scale with the width. */
export function SlideScreen({ faces, className, textClass = 'text-[4.5cqw]' }: { faces: ScreenFaces; className: string; textClass?: string }) {
  const { up, was, p, from } = faces;
  const layer = (face: DisplayCue | null, opacity: number) => {
    if (!face || opacity <= 0) return null;
    if (face.logo) {
      return (
        <div key={face.seq} className="absolute inset-0 flex items-center justify-center bg-[#121619]" style={{ opacity }}>
          <img src="/brand/logo-dark.webp" alt="" width={600} height={376} className="h-3/5 w-auto" draggable={false} />
        </div>
      );
    }
    return face.text ? (
      <div key={face.seq} className={`absolute inset-0 flex flex-col items-center justify-center px-[6cqw] text-center ${textClass} font-bold leading-tight text-white`} style={{ opacity }}>
        {face.text.split('\n').map((line, k) => (
          <p key={k}>{line}</p>
        ))}
      </div>
    ) : null;
  };
  return (
    <div className={`relative overflow-hidden bg-black ring-1 ring-line [container-type:inline-size] ${className}`} role="img" aria-label={up?.logo ? 'The screen shows the logo' : up?.text ? `The screen shows: ${up.text.replace(/\n/g, ' / ')}` : 'The screen is black'}>
      {layer(was, (1 - p) * from)}
      {layer(up, p)}
    </div>
  );
}
