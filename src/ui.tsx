import { Fragment, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Monitor, Moon, Sun } from 'lucide-react';
import type { Song } from './types';
import { shadeOf, type SectionView, type Shade } from './lib/songMap';
import { setTheme, useTheme, type Theme } from './theme';

type Tone = 'primary' | 'outline' | 'lantern' | 'quiet';

/** Amber is the lamp: the one thing to do next. The lantern tone is the navy body around it. */
const TONES: Record<Tone, string> = {
  primary: 'bg-accent font-semibold text-navy hover:bg-accent-hover hover:shadow-glow-sm disabled:bg-raised disabled:text-faint disabled:shadow-none',
  outline: 'border border-edge bg-panel text-ink hover:border-accent/70 hover:bg-raised disabled:border-line disabled:bg-panel disabled:text-faint',
  lantern: 'bg-lantern text-cream hover:bg-lantern/85 disabled:bg-raised disabled:text-faint',
  quiet: 'text-ink hover:bg-raised',
};

export function Button({ tone = 'outline', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 font-medium transition disabled:cursor-not-allowed ${TONES[tone]} ${className}`}
      {...props}
    />
  );
}

export function LinkButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`font-medium text-amber underline decoration-amber/40 underline-offset-4 hover:decoration-amber ${className}`} {...props} />;
}

/**
 * Acts only after a press held for `ms`, filling in as it goes, so a stray touch cannot stop a song.
 * Sliding off by more than a fingertip lets go. A keyboard press acts at once.
 */
export function HoldButton(props: { onConfirm: () => void; ms?: number; disabled?: boolean; className?: string; children: ReactNode }) {
  const { onConfirm, ms = 600, disabled, className = '', children } = props;
  const [holding, setHolding] = useState(false);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const letGo = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    setHolding(false);
  };
  useEffect(() => () => window.clearTimeout(press.current?.timer), []);
  return (
    <button
      type="button"
      title="Press and hold"
      disabled={disabled}
      className={`relative touch-none overflow-hidden ${className}`}
      onPointerDown={event => {
        if (event.button !== 0 || press.current) return;
        const timer = window.setTimeout(() => {
          letGo();
          onConfirm();
        }, ms);
        press.current = { timer, x: event.clientX, y: event.clientY };
        setHolding(true);
        // So a mouse let go off the button still lets go. Touches are captured anyway.
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // A pointer the browser is not tracking cannot be captured. Its pointerup on the button still lets go.
        }
      }}
      onPointerMove={event => {
        const start = press.current;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) letGo();
      }}
      onPointerUp={letGo}
      onPointerCancel={letGo}
      onContextMenu={event => event.preventDefault()}
      onClick={event => {
        if (event.detail === 0) onConfirm();
      }}
    >
      <span
        className="absolute inset-y-0 left-0 bg-danger/30"
        style={{ width: holding ? '100%' : '0%', transition: holding ? `width ${ms}ms linear` : 'none' }}
        aria-hidden
      />
      <span className="relative inline-flex items-center justify-center gap-2">{children}</span>
    </button>
  );
}

/** Heights of the logo's sound bars, quieted down. The short one in the middle stays lit, like an ember. */
const RESTING = [14, 22, 34, 20, 12, 20, 34, 22, 14];

/** The logo's sound bars at rest, breathing slowly: for empty lists and waiting. */
export function RestingBars({ className = '' }: { className?: string }) {
  return (
    <div className={`flex h-12 items-center gap-2 ${className}`} aria-hidden>
      {RESTING.map((height, i) => (
        <span
          key={i}
          className={`breathe w-2.5 rounded-full ${i === 4 ? 'bg-accent shadow-glow-sm' : 'bg-edge/50'}`}
          style={{ height, animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  );
}

const THEMES: Array<[Theme, string, typeof Sun]> = [
  ['light', 'Light', Sun],
  ['dark', 'Dark', Moon],
  ['system', 'Auto', Monitor],
];

/** Light, dark, or follow the system. */
export function ThemeSwitch() {
  const { choice } = useTheme();
  return (
    <div className="flex rounded-full border border-ink/15 p-1" role="group" aria-label="Theme">
      {THEMES.map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          aria-pressed={choice === value}
          title={value === 'system' ? 'Follow this device' : label}
          className={`flex flex-1 items-center justify-center gap-1 rounded-full py-1.5 text-xs ${choice === value ? 'bg-accent/25 font-semibold' : 'text-ink/70 hover:text-ink'}`}
          onClick={() => setTheme(value)}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="sr-only sm:not-sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}

/** One tap between light and dark, for Perform. */
export function ThemeToggle() {
  const { dark } = useTheme();
  const Icon = dark ? Sun : Moon;
  return (
    <button
      type="button"
      className="rounded-full border border-line p-2.5 text-muted hover:bg-panel hover:text-ink"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-panel ${className}`}>{children}</section>;
}

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`caps text-muted ${className}`}>{children}</p>;
}

/** A disclosure with its own outside-click close. */
export function Menu({ label, children, align = 'right' }: { label: string; children: ReactNode; align?: 'left' | 'right' }) {
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
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 hover:bg-raised ${open ? 'bg-raised' : ''}`}
        onClick={() => setOpen(!open)}
      >
        {label}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div
          className={`absolute z-20 mt-1.5 min-w-[15rem] rounded-xl border border-line bg-panel p-1.5 shadow-xl shadow-navy/15 dark:shadow-black/50 ${align === 'right' ? 'right-0' : 'left-0'}`}
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
      className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-raised disabled:text-faint disabled:hover:bg-transparent ${danger ? 'text-danger' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Stepper({ value, label, onChange, min, max, step = 1, name }: { value: number; label: string; onChange: (value: number) => void; min: number; max: number; step?: number; name: string }) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, Math.round(next / step) * step)));
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-full border border-edge bg-panel" role="group" aria-label={name}>
      <button type="button" className="w-11 border-r border-edge text-lg text-amber hover:bg-raised disabled:text-faint" onClick={() => set(value - step)} disabled={value <= min} aria-label={`Less ${name}`}>
        –
      </button>
      <output className="tabular flex min-w-[6.5rem] items-center justify-center px-3 py-2.5 text-[17px] font-medium" aria-live="polite">
        {label}
      </output>
      <button type="button" className="w-11 border-l border-edge text-lg text-amber hover:bg-raised disabled:text-faint" onClick={() => set(value + step)} disabled={value >= max} aria-label={`More ${name}`}>
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
  light: 'bg-shade-light text-on-shade-light',
  mid: 'bg-shade-mid text-on-shade-mid',
  dark: 'bg-shade-dark text-on-shade-dark',
  black: 'bg-shade-black text-on-shade-black',
};

export function shadeClass(view: SectionView): string {
  return SHADE[shadeOf(view.section.type)];
}

/** The small strip on Library: one block per section, sized by bars, wrapping onto more rows for long songs. */
export function MiniStrip({ views }: { views: SectionView[] }) {
  if (views.length === 0) return <p className="text-sm text-muted">No sections yet.</p>;
  return (
    <div className="flex flex-wrap gap-x-0.5 gap-y-1" aria-label={`Sections: ${views.map(view => view.name).join(', ')}`}>
      {views.map(view => (
        <div
          key={view.section.id}
          className={`flex h-7 min-w-fit items-center justify-center rounded-full px-2 text-[11px] font-semibold ${shadeClass(view)}`}
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
              className={`px-4 py-2 text-sm ${here ? 'border border-transparent shadow-glow-sm' : ''}`}
              onClick={() => onStep(step)}
            >
              {done.includes(step) && !here && <Check className="h-4 w-4 text-amber" role="img" aria-label="Done" />}
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
        <h1 className="text-4xl font-extrabold tracking-tight">{song.title}</h1>
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
      // A dialog over the page, like the Mac app's Send feedback, keeps its keys to itself.
      if (document.querySelector('[aria-modal="true"]')) return;
      latest.current(event);
    };
    window.addEventListener('keydown', listen);
    return () => window.removeEventListener('keydown', listen);
  }, []);
}
