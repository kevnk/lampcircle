import { StoreProvider, go, useRoute, useStore, type Route } from './store';
import { Library } from './screens/Library';
import { SongTap } from './screens/SongTap';
import { Refine } from './screens/Refine';
import { Export } from './screens/Export';
import { Sets } from './screens/Sets';
import { Perform } from './screens/Perform';
import { RestingBars, ThemeSwitch } from './ui';
import { isIOS, isTauri } from './platform';
import { Desktop } from './desktop/Desktop';
import { Mobile, ReadOnlyMap, TabBar } from './mobile/Mobile';

export default function App() {
  return (
    <StoreProvider>
      <Shell />
      {isTauri() && <Desktop />}
      {isIOS() && <Mobile />}
    </StoreProvider>
  );
}

function Shell() {
  const route = useRoute();
  const { loaded, loadError } = useStore();
  if (loadError) return <p className="p-8">Could not open your library. {loadError} Close other tabs of this app and reload.</p>;
  if (!loaded) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 text-muted">
        <RestingBars />
        <p>Loading your library…</p>
      </div>
    );
  }
  if (route.page === 'perform') return <Perform key={`${route.setId}`} setId={route.setId} item={route.item} />;
  // iPhone and iPad: one column inside the safe areas, with tabs along the bottom.
  if (isIOS()) {
    return (
      <>
        <main className="min-w-0 pb-[calc(6rem_+_env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[calc(1rem_+_env(safe-area-inset-top))]">
          <Page route={route} />
          <div className="mt-10 max-w-xs">
            <ThemeSwitch />
          </div>
        </main>
        <TabBar route={route} />
      </>
    );
  }
  return (
    <div className="flex min-h-full">
      {/* The Mac app has no title bar, so the window drags from the top edge. */}
      {isTauri() && <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-30 h-7" />}
      <Sidebar route={route} />
      <main className="min-w-0 flex-1 px-5 py-7 sm:px-8">
        <Page route={route} />
      </main>
    </div>
  );
}

function Page({ route }: { route: Route }) {
  const { songs } = useStore();
  if (route.page === 'sets') return <Sets id={route.id} />;
  if (route.page === 'song') {
    const song = songs.find(item => item.id === route.id);
    if (!song) return <p className="text-muted">That song is not in your library.</p>;
    if (isIOS() && route.step !== 'tap') return <ReadOnlyMap song={song} step={route.step} />;
    if (route.step === 'refine') return <Refine song={song} />;
    if (route.step === 'export') return <Export song={song} />;
    return <SongTap key={song.id} song={song} />;
  }
  return <Library />;
}

function Sidebar({ route }: { route: Route }) {
  const items: Array<[string, Route, boolean]> = [
    ['Library', { page: 'library' }, route.page === 'library' || route.page === 'song'],
    ['Sets', { page: 'sets' }, route.page === 'sets'],
  ];
  return (
    <nav
      data-tauri-drag-region
      className="sticky top-0 flex h-screen w-44 shrink-0 flex-col overflow-y-auto bg-side px-4 py-6 sm:w-[230px] [.desktop_&]:pt-16"
      aria-label="Main"
    >
      <img src="/brand/logo.webp" alt="Lamp Circle" width={600} height={376} className="mx-auto mb-8 w-3/4 max-w-[142px] dark:hidden" draggable={false} />
      <img src="/brand/logo-dark.webp" alt="Lamp Circle" width={600} height={376} className="mx-auto mb-8 hidden w-3/4 max-w-[142px] dark:block" draggable={false} />
      <ul className="space-y-1.5">
        {items.map(([label, target, active]) => (
          <li key={label}>
            <button
              type="button"
              aria-current={active ? 'page' : undefined}
              className={`flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-left text-[17px] ${active ? 'bg-accent/25 font-semibold' : 'text-ink/75 hover:bg-ink/5 hover:text-ink'}`}
              onClick={() => go(target)}
            >
              <span className={`h-5 w-1.5 rounded-full ${active ? 'bg-accent shadow-glow-sm' : 'bg-ink/15'}`} aria-hidden />
              {label}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-6">
        <ThemeSwitch />
      </div>
    </nav>
  );
}
