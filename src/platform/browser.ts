import type { Platform } from './types';

/** The web app: server/index.js does the downloads, through Vite's /api proxy. */
export const browserPlatform: Platform = {
  helper: {
    async jobs() {
      const response = await fetch('/api/downloads');
      if (!response.ok) throw new Error('The download helper is not running.');
      return response.json();
    },
    async add(url, kind, map, title) {
      const response = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, kind, map, title }),
      }).catch(() => null);
      if (!response) throw new Error('The download helper is not running. Start it with npm run dev.');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Download failed.');
      return body;
    },
    async list(url) {
      const response = await fetch(`/api/list?url=${encodeURIComponent(url)}`).catch(() => null);
      if (!response) throw new Error('The download helper is not running. Start it with npm run dev.');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not read that playlist.');
      return body;
    },
    async remove(id) {
      await fetch(`/api/downloads/${id}`, { method: 'DELETE' });
    },
    async file(name) {
      const response = await fetch(`/api/file/${encodeURIComponent(name)}`);
      if (!response.ok) throw new Error(`Could not read ${name}.`);
      return response.blob();
    },
  },
  async saveText(text, fileName) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/yaml' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: fileName });
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },
};
