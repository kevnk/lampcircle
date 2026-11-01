import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { Song } from '../types';
import { Menu, MenuItem } from '../ui';
import { loadLyricsPrefs } from '../lib/lyricsDisplay';
import { applyBarsToBlock, laneSlides, makeBlank, mergeNext, moveSlideEdge, placementOf, setSlideText, slideLines, splitSlide, splitText, type LaneSlide } from '../lib/lyricsEdit';
import { sectionViews, songGrid } from '../lib/songMap';

/** Applies a change to the latest song through the page's save, so it undoes like a section edit. False when nothing changed. */
export type LyricsEdit = (change: (song: Song) => Song, undoable?: boolean) => boolean;

type Picked = { sectionId: string; i: number; editing: boolean };

/**
 * The lyrics lane under the section strip: a box per slide from its bar to the next, with a wedge where the change
 * starts. Click a slide to go to it, double-click to change its words, drag its left edge to move it. With no `edit`
 * (the phone) it only shows and seeks.
 */
export function LyricsLane({ song, edit, onSeek, onPick }: { song: Song; edit: LyricsEdit | null; onSeek: (t: number) => void; onPick: () => void }) {
  const lane = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [defaults] = useState(loadLyricsPrefs);
  const slides = laneSlides(song, defaults);
  const placement = placementOf(song);
  const duration = song.duration || 1;
  const pct = (t: number) => `${(t / duration) * 100}%`;
  const estimated = placement?.offsetEstimated ? slides.find(slide => slide.lines.length) : undefined;
  const current = picked && slides.find(slide => slide.sectionId === picked.sectionId && slide.i === picked.i);
  const names = new Map(sectionViews(song).map(view => [view.section.id, view.name]));

  useEffect(() => {
    if (!picked) return;
    const close = (event: MouseEvent) => {
      if (!lane.current?.contains(event.target as Node)) setPicked(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(event.target instanceof HTMLTextAreaElement)) setPicked(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [Boolean(picked)]);

  if (!slides.length && !placement?.unplaced.length) return null;
  const timeAt = (clientX: number) => {
    const rect = lane.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration;
  };
  const pick = (slide: LaneSlide, editing: boolean) => {
    setPicked({ sectionId: slide.sectionId, i: slide.i, editing: editing && edit !== null });
    onPick();
  };

  return (
    <div ref={lane} className="relative mt-1 h-9" role="group" aria-label="Lyrics slides">
      {slides.map(slide => {
        const marks = [slide.check && 'Check words: from YouTube auto captions', slide === estimated && 'Timing estimated: check the first line'].filter(Boolean);
        const here = current === slide;
        const words = slide.lines.join(' / ');
        return (
          <button
            key={`${slide.sectionId}:${slide.i}`}
            type="button"
            // As wide as its bars, even on the phone, where buttons are otherwise at least 44pt.
            className="absolute inset-y-0 pr-0.5 ios:!min-h-0 ios:!min-w-0"
            style={{ left: pct(slide.start), width: pct(slide.end - slide.start) }}
            title={[words || 'Blank: the screen goes black', ...marks].join('\n')}
            aria-label={`${names.get(slide.sectionId)} slide ${slide.i + 1}: ${words || 'blank'}${marks.length ? `. ${marks.join('. ')}` : ''}`}
            aria-pressed={here}
            onClick={() => {
              pick(slide, false);
              onSeek(slide.start);
            }}
            onDoubleClick={() => pick(slide, true)}
          >
            <span
              className={`relative flex h-full items-center overflow-hidden whitespace-nowrap rounded-md border px-1.5 text-[11px] ${
                slide.lines.length ? 'bg-raised text-ink' : 'border-dashed bg-transparent'
              } ${marks.length ? 'border-accent' : 'border-edge'} ${here ? 'ring-2 ring-accent ring-offset-1 ring-offset-panel' : 'hover:brightness-110'}`}
            >
              {slide.lines[0] ?? ''}
              {marks.length > 0 && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
            </span>
            {edit && slide.i > 0 && (
              <span
                className="absolute inset-y-0 -left-0.5 w-2 cursor-ew-resize touch-none"
                aria-hidden
                data-slide-edge={`${slide.sectionId}:${slide.i}`}
                onClick={event => event.stopPropagation()}
                onDoubleClick={event => event.stopPropagation()}
                onPointerDown={event => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  dragged.current = false;
                }}
                onPointerMove={event => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                  // The first bar moved is the undo step for the whole drag.
                  if (edit(latest => moveSlideEdge(latest, slide.sectionId, slide.i, timeAt(event.clientX)), !dragged.current)) dragged.current = true;
                }}
              />
            )}
          </button>
        );
      })}
      {slides
        .filter(slide => slide.changeAt < slide.start)
        .map(slide => (
          <div
            key={`lead-${slide.sectionId}:${slide.i}`}
            className="pointer-events-none absolute inset-y-0 bg-accent/30 [clip-path:polygon(0_100%,100%_0,100%_100%)]"
            style={{ left: pct(slide.changeAt), width: pct(slide.start - slide.changeAt) }}
            aria-hidden
          />
        ))}
      {placement?.unplaced.map((line, k) => (
        <span
          key={`unplaced-${k}`}
          className="absolute inset-y-1 w-1 -translate-x-1/2 rounded-full bg-accent"
          style={{ left: pct(Math.min(duration, Math.max(0, line.start))) }}
          title={`Unplaced: ${line.text}`}
          role="img"
          aria-label={`Unplaced line: ${line.text}`}
        />
      ))}
      {edit && current && <SlideInspector song={song} slide={current} editing={picked!.editing} edit={edit} setPicked={setPicked} marks={current === estimated} />}
    </div>
  );
}

/** The picked slide's words and what can be done to it, under the lane. */
function SlideInspector({ song, slide, editing, edit, setPicked, marks }: { song: Song; slide: LaneSlide; editing: boolean; edit: LyricsEdit; setPicked: (picked: Picked | null) => void; marks: boolean }) {
  const view = sectionViews(song).find(item => item.section.id === slide.sectionId)!;
  const d = songGrid(song).downbeats;
  const { sectionId, i } = slide;
  const count = laneSlides(song).filter(item => item.sectionId === sectionId).length;
  const users = sectionViews(song).filter(item => item.section.lyric?.block === slide.block).length;
  const center = ((slide.start + slide.end) / 2 / (song.duration || 1)) * 100;
  const icon = 'rounded-full p-1 text-muted hover:bg-raised hover:text-ink disabled:text-faint disabled:hover:bg-transparent';
  const moveTo = (bar: number) => (latest: Song) => moveSlideEdge(latest, sectionId, i, d[view.s + bar]);
  const act = (op: (latest: Song, id: string, index: number) => Song) => {
    setPicked({ sectionId, i, editing: false });
    edit(latest => op(latest, sectionId, i));
  };
  return (
    <div
      role="dialog"
      aria-label={`${view.name} slide ${i + 1}`}
      className="absolute top-full z-20 mt-2 w-80 rounded-2xl border border-edge bg-panel p-4 shadow-2xl shadow-navy/15 dark:shadow-black/60"
      style={{ left: `clamp(0px, calc(${center}% - 10rem), calc(100% - 20rem))` }}
    >
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="font-semibold">
          {view.name} · slide {i + 1} of {count}
        </span>
        <span className="flex items-center tabular text-xs text-muted">
          <button type="button" className={icon} aria-label="Start a bar earlier" disabled={moveTo(slide.bar - 1)(song) === song} onClick={() => edit(moveTo(slide.bar - 1))}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          bar {view.s + slide.bar + 1}
          <button type="button" className={icon} aria-label="Start a bar later" disabled={moveTo(slide.bar + 1)(song) === song} onClick={() => edit(moveTo(slide.bar + 1))}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </span>
        <button type="button" className={`ml-auto ${icon}`} aria-label="Close" onClick={() => setPicked(null)}>
          <X className="h-4 w-4" />
        </button>
      </div>
      {editing ? (
        <SlideEditor key={`${sectionId}:${i}`} lines={slide.lines} edit={edit} slide={slide} setPicked={setPicked} />
      ) : (
        <button
          type="button"
          className="block w-full rounded-lg border border-line bg-well px-3 py-2 text-left text-sm hover:border-accent/70"
          title="Change the words"
          onClick={() => setPicked({ sectionId, i, editing: true })}
        >
          {slide.lines.length ? slide.lines.map((line, k) => <span key={k} className="block">{line}</span>) : <span className="text-muted">Blank: the screen goes black.</span>}
        </button>
      )}
      {(slide.check || marks || users > 1) && (
        <ul className="mt-2 space-y-1 text-xs">
          {slide.check && <li className="text-amber">Check words: these came from YouTube auto captions.</li>}
          {marks && <li className="text-amber">Timing estimated: check this line comes in on time, then nudge in the Lyrics panel.</li>}
          {users > 1 && <li className="text-muted">These words show in {users} sections, so a change shows in all of them.</li>}
        </ul>
      )}
      <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm">
        <span className="text-xs text-muted">Drag its left edge to move it.</span>
        <Menu label="⋯">
          <MenuItem onClick={() => act(splitSlide)} disabled={splitSlide(song, sectionId, i) === song}>
            Split
            <span className="block text-xs text-muted">Half its lines come in halfway to the next slide.</span>
          </MenuItem>
          <MenuItem onClick={() => act(mergeNext)} disabled={mergeNext(song, sectionId, i) === song}>
            Merge with next
          </MenuItem>
          <MenuItem onClick={() => act(makeBlank)} disabled={makeBlank(song, sectionId, i) === song}>
            Make blank
            <span className="block text-xs text-muted">The screen goes black for this slide.</span>
          </MenuItem>
          <MenuItem onClick={() => edit(latest => applyBarsToBlock(latest, sectionId))} disabled={applyBarsToBlock(song, sectionId) === song}>
            Use these bar positions for every section using this block
          </MenuItem>
        </Menu>
      </div>
    </div>
  );
}

/** Words in a text box: Enter for a new line, Cmd+Enter splits the slide at the cursor, Escape leaves it as it was. Leaving the box keeps the words. */
function SlideEditor({ lines, edit, slide, setPicked }: { lines: string[]; edit: LyricsEdit; slide: LaneSlide; setPicked: (picked: Picked | null) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const { sectionId, i } = slide;
  const text = useRef(lines.join('\n'));
  /** The text last saved. Only typing since then is saved, so it never undoes a split or merge made from the menu meanwhile. */
  const saved = useRef(text.current);
  /** Split or cancelled, so closing saves nothing more. */
  const done = useRef(false);
  const commit = () => {
    if (done.current || text.current === saved.current) return;
    saved.current = text.current;
    edit(latest => setSlideText(latest, sectionId, i, text.current));
  };
  const keep = useRef(commit);
  keep.current = commit;
  // A click outside can close the box before it blurs, so closing keeps the words too.
  useEffect(() => () => keep.current(), []);
  // Words changed from outside, by Place again or the nudge: the box closes rather than show, and later save, old words.
  const shown = lines.join('\n');
  useEffect(() => {
    if (shown === slideLines(saved.current).join('\n')) return;
    done.current = true;
    setPicked({ sectionId, i, editing: false });
  }, [shown]);
  return (
    <div>
      <textarea
        autoFocus
        aria-label="Words on this slide, one line per line"
        defaultValue={text.current}
        rows={Math.max(2, lines.length + 1)}
        className="block w-full resize-y rounded-lg border border-edge bg-well px-3 py-2 text-sm"
        onChange={event => (text.current = event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          const box = event.currentTarget;
          if (event.key === 'Escape') {
            done.current = true;
            setPicked({ sectionId, i, editing: false });
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (edit(latest => splitSlide(latest, sectionId, i, splitText(box.value, box.selectionStart)))) {
              done.current = true;
              setPicked({ sectionId, i: i + 1, editing: true });
            } else {
              setProblem('Not split: both halves need words, and every section showing it needs a bar for each.');
            }
          }
        }}
      />
      <p className="mt-1 text-xs text-muted">Enter for a new line · ⌘Enter splits here · Esc cancels</p>
      {problem && <p className="mt-1 text-xs text-amber">{problem}</p>}
    </div>
  );
}
