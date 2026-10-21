import { Fragment, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { Song } from './types';
import { shadeOf, type SectionView, type Shade } from './lib/songMap';

type Tone = 'primary' | 'outline' | 'dark' | 'quiet';

const TONES: Record<Tone, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover disabled:bg-faint',
  outline: 'border border-ink bg-white text-ink hover:bg-paper disabled:border-line disabled:text-faint',
  dark: 'bg-ink text-white hover:bg-black disabled:bg-faint',
  quiet: 'text-ink hover:bg-paper',
};

export function Button({ tone = 'outline', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 font-medium transition-colors disabled:cursor-not-allowed ${TONES[tone]} ${className}`}
      {...props}
    />
  );
}

export function LinkButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`font-medium text-accent underline underline-offset-2 hover:text-accent-hover ${className}`} {...props} />;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-md border border-line bg-white ${className}`}>{children}</section>;
}

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`font-mono text-xs uppercase tracking-wider text-muted ${className}`}>{children}</p>;
}

/** A disclosure with its own outside-click close. */
export function Menu({ label, children, align = 'right', dark = false }: { label: string; children: ReactNode; align?: 'left' | 'right'; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 ${dark ? 'text-stage-text hover:bg-stage-card' : 'hover:bg-paper'}`}
        onClick={() => setOpen(!open)}
      >
        {label}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div
          className={`absolute z-20 mt-1 min-w-[15rem] rounded-md border p-1.5 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'} ${dark ? 'border-stage-line bg-stage-card text-stage-text' : 'border-line bg-white'}`}
          onClick={event => {
            if ((event.target as HTMLElement).closest('[data-close]')) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, danger = false, disabled = false }: { children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      data-close
      disabled={disabled}
      className={`block w-full rounded px-3 py-2 text-left text-sm hover:bg-paper disabled:text-faint disabled:hover:bg-transparent ${danger ? 'text-accent' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Stepper({ value, label, onChange, min, max, step = 1, name }: { value: number; label: string; onChange: (value: number) => void; min: number; max: number; step?: number; name: string }) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, Math.round(next / step) * step)));
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-md border border-ink bg-white" role="group" aria-label={name}>
      <button type="button" className="w-11 border-r border-ink text-lg hover:bg-paper disabled:text-faint" onClick={() => set(value - step)} disabled={value <= min} aria-label={`Less ${name}`}>
        –
      </button>
      <output className="flex min-w-[6.5rem] items-center justify-center px-3 py-2.5 font-mono text-lg" aria-live="polite">
        {label}
      </output>
      <button type="button" className="w-11 border-l border-ink text-lg hover:bg-paper disabled:text-faint" onClick={() => set(value + step)} disabled={value >= max} aria-label={`More ${name}`}>
        +
      </button>
    </div>
  );
}

export function beatsLabel(beats: number): string {
  const whole = Math.floor(beats);
  const text = beats % 1 ? `${whole ? whole : ''}½` : String(whole);
  return `${text} beat${beats === 1 ? '' : 's'}`;
}

const SHADE: Record<Shade, string> = {
  light: 'bg-shade-light text-ink',
  mid: 'bg-shade-mid text-ink',
  dark: 'bg-shade-dark text-white',
  black: 'bg-shade-black text-white',
};

export function shadeClass(view: SectionView): string {
  return SHADE[shadeOf(view.section.type)];
}

/** The small strip on Library: one block per section, sized by bars, wrapping onto more rows for long songs. */
export function MiniStrip({ views }: { views: SectionView[] }) {
  if (views.length === 0) return <p className="text-sm text-muted">No sections yet.</p>;
  return (
    <div className="flex flex-wrap gap-x-px gap-y-1" aria-label={`Sections: ${views.map(view => view.name).join(', ')}`}>
      {views.map(view => (
        <div
          key={view.section.id}
          className={`flex h-7 min-w-fit items-center justify-center px-1.5 font-mono text-[11px] ${shadeClass(view)}`}
          style={{ width: `${(view.e - view.s) * 0.25}rem` }}
          title={view.name}
        >
          {view.short}
        </div>
      ))}
    </div>
  );
}

export type StepName = 'tap' | 'sections' | 'refine' | 'export';

export function StepPills({ current, done, onStep }: { current: StepName[]; done: StepName[]; onStep: (step: StepName) => void }) {
  const steps: Array<[StepName, string]> = [
    ['tap', 'Map Song'],
    ['refine', 'Transitions'],
    ['export', 'Export'],
  ];
  return (
    <nav className="flex flex-wrap items-center gap-1.5" aria-label="Steps">
      {steps.map(([step, label], index) => {
        const here = current.includes(step);
        return (
          <Fragment key={step}>
            {index > 0 && <ChevronRight className="h-4 w-4 text-faint" aria-hidden />}
            <Button
              tone={here ? 'primary' : 'outline'}
              aria-current={here ? 'step' : undefined}
              className={`px-3.5 py-2 text-sm ${here ? 'border border-transparent' : ''}`}
              onClick={() => onStep(step)}
            >
              {done.includes(step) && !here && <Check className="h-4 w-4" role="img" aria-label="Done" />}
              {label}
            </Button>
          </Fragment>
        );
      })}
    </nav>
  );
}

export function SongHeader({ song, meta, children }: { song: Song; meta: string; children: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">{song.title}</h1>
        <p className="mt-1 text-muted">{meta}</p>
      </div>
      <div className="pt-3">{children}</div>
    </header>
  );
}

/** Re-render on animation frames, at most about 30 times a second. */
export function useFrame(active = true): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    let id = 0;
    let last = 0;
    const loop = (time: number) => {
      if (time - last > 33) {
        last = time;
        setFrame(value => value + 1);
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
  return frame;
}

/** Window keydown, skipped while typing in a field. */
export function useKeys(handler: (event: KeyboardEvent) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const listen = (event: KeyboardEvent) => {
      // Typing in a text field is not a shortcut. Sliders, checkboxes and selects keep the shortcuts working.
      const target = event.target as HTMLElement | null;
      const typing = target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'file'].includes(target.type);
      if (typing || target?.closest('textarea, [contenteditable="true"]')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      latest.current(event);
    };
    window.addEventListener('keydown', listen);
    return () => window.removeEventListener('keydown', listen);
  }, []);
}
