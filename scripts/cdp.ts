// Minimal Chrome DevTools Protocol driver: launch headless Chrome, talk to one page.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class Cdp {
  ws: WebSocket;
  #id = 0;
  #pending = new Map<number, { ok: (value: any) => void; fail: (error: Error) => void }>();
  #events = new EventTarget();

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id === undefined) {
        this.#events.dispatchEvent(new CustomEvent(message.method, { detail: message.params }));
        return;
      }
      const pending = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error) pending?.fail(new Error(message.error.message));
      else pending?.ok(message.result);
    };
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((ok, fail) => {
      const ws = new WebSocket(url);
      ws.onopen = () => ok(new Cdp(ws));
      ws.onerror = () => fail(new Error(`cannot connect ${url}`));
    });
  }

  send<T = any>(method: string, params: object = {}): Promise<T> {
    const id = ++this.#id;
    return new Promise((ok, fail) => {
      this.#pending.set(id, { ok, fail });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Register before the action that fires the event. */
  once<T = any>(method: string, match: (params: any) => boolean = () => true, ms = 20000): Promise<T> {
    return new Promise((ok, fail) => {
      const listener = (event: Event) => {
        const params = (event as CustomEvent).detail;
        if (!match(params)) return;
        clearTimeout(timer);
        this.#events.removeEventListener(method, listener);
        ok(params);
      };
      const timer = setTimeout(() => {
        this.#events.removeEventListener(method, listener);
        fail(new Error(`timeout waiting for ${method}`));
      }, ms);
      this.#events.addEventListener(method, listener);
    });
  }

  async eval<T = any>(expression: string): Promise<T> {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
}

export interface Chrome {
  proc: ChildProcess;
  port: number;
  browser: Cdp;
  profile: string;
}

export async function launch(): Promise<Chrome> {
  const profile = mkdtempSync(join(tmpdir(), 'djw-e2e-chrome-'));
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      // The test audio is generated tones; keep them out of the speakers.
      '--mute-audio',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 300; i++) {
    const lines = existsSync(portFile) ? readFileSync(portFile, 'utf8').trim().split('\n') : [];
    if (lines.length === 2) {
      const port = Number(lines[0]);
      return { proc, port, browser: await Cdp.connect(`ws://127.0.0.1:${port}${lines[1]}`), profile };
    }
    await sleep(50);
  }
  proc.kill('SIGKILL');
  throw new Error('Chrome did not start');
}

export async function openPage(chrome: Chrome): Promise<Cdp> {
  const { targetId } = await chrome.browser.send('Target.createTarget', { url: 'about:blank' });
  const page = await Cdp.connect(`ws://127.0.0.1:${chrome.port}/devtools/page/${targetId}`);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  return page;
}

export async function close(chrome: Chrome) {
  chrome.browser.send('Browser.close').catch(() => {});
  for (let i = 0; i < 60 && chrome.proc.exitCode === null && chrome.proc.signalCode === null; i++) await sleep(50);
  if (chrome.proc.exitCode === null && chrome.proc.signalCode === null) chrome.proc.kill('SIGKILL');
  chrome.browser.ws.close();
  rmSync(chrome.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
