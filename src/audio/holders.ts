/** What plays through the audio session: the transport, or a Perform session. */
export interface Holder {
  readonly paused: boolean;
  pause(): void;
}

export interface AudioPort {
  /** Take the audio session from other apps. Done when the session is ours. */
  claim(): Promise<unknown>;
  /** Give it back and tell other apps they can play. */
  giveBack(): void;
  /** Start the audio clock. */
  run(): void;
  /** Stop the audio clock. */
  rest(): Promise<unknown>;
}

/**
 * iPhone and iPad: who is using the audio session, so other apps' music plays on until Lamp Circle really plays.
 * The session goes back a while after the last holder lets go, so a seek or a short pause never starts other apps up.
 * WebKit may run a session of its own, and two sessions that won't mix cut each other off. So the app's goes first,
 * as it always has, and is taken once. Taking it again mid-set could silence the song. Waiting costs no timing:
 * everything is scheduled against the audio clock, which stands still until it runs.
 */
export class AudioHolders {
  private holders = new Set<Holder>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Done when the session is ours. Null until something plays, and again once it has gone. */
  private claimed: Promise<unknown> | null = null;
  private port: AudioPort;
  private graceMs: number;

  constructor(port: AudioPort, graceMs: number) {
    this.port = port;
    this.graceMs = graceMs;
  }

  hold(who: Holder) {
    this.holders.add(who);
    clearTimeout(this.timer);
    this.claimed ??= this.port.claim();
    // Pause or leave before the session arrives, and nothing starts.
    void this.claimed.then(() => {
      if (this.holders.has(who) && !who.paused) this.port.run();
    });
  }

  letGo(who: Holder) {
    if (!this.holders.delete(who) || this.holders.size) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      // Someone may start playing while the clock stops. Their run() comes after this rest(), so they keep the clock.
      void this.port.rest().then(() => {
        if (this.holders.size) return;
        this.claimed = null;
        this.port.giveBack();
      });
    }, this.graceMs);
  }

  /** The first tap has unlocked audio. With nothing to play, the clock rests until something does. */
  unlocked() {
    if (!this.holders.size) void this.port.rest();
  }

  /** The headphones came out. Holders stay paused until a tap. */
  pauseAll() {
    this.holders.forEach(who => who.pause());
  }

  /** A phone call took the session. Holders stay paused until a tap, and the next one takes the session back. */
  interrupted() {
    this.claimed = null;
    this.pauseAll();
  }

  /** Back from the background, WebKit may have stopped the clock under something still playing. */
  wake() {
    if ([...this.holders].some(who => !who.paused)) this.port.run();
  }
}
