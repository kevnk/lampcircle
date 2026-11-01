import { useEffect, useRef } from 'react';
import { audio, now, type PerformSession, type Snapshot } from '../audio/engine';
import { hapticTicks, queuedSection } from '../lib/haptics';
import { desktop, isIOS, mobile } from '../platform';

/** Perform's ticks on iPhone and iPad. Nothing happens anywhere else. */
export function useHaptics(session: PerformSession | null, snap: Snapshot | null) {
  const ticks = useRef<ReturnType<typeof hapticTicks> | null>(null);

  useEffect(() => {
    if (!isIOS()) return;
    // Off until the setting is in, so a phone with Haptics off never ticks. Perform covers the Settings tab, so it can't change meanwhile.
    let on = false;
    void desktop.getSettings().then(
      settings => {
        on = settings.hapticsEnabled;
      },
      () => undefined,
    );
    const made = hapticTicks({
      clock: now,
      latency: () => (audio().ctx.baseLatency || 0) + (audio().ctx.outputLatency || 0),
      ready: () => on && document.visibilityState === 'visible',
      fire: kind => void mobile.haptic(kind).catch(() => undefined),
      schedule: (run, seconds) => {
        const timer = window.setTimeout(run, seconds * 1000);
        return () => window.clearTimeout(timer);
      },
    });
    ticks.current = made;
    return () => {
      made.stop();
      ticks.current = null;
    };
  }, []);

  useEffect(() => {
    ticks.current?.update(queuedSection(snap?.song, session?.segments[0]), snap?.paused ?? false);
  });
}
