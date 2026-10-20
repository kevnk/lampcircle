import { StoreProvider, go, useRoute, useStore, type Route } from './store';
import { Library } from './screens/Library';
import { SongTap } from './screens/SongTap';
import { Refine } from './screens/Refine';
import { Export } from './screens/Export';
import { Sets } from './screens/Sets';
import { Perform } from './screens/Perform';

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const route = useRoute();
  const { loaded, loadError } = useStore();
  if (loadError) return <p className="p-8">Could not open your library. {loadError} Close other tabs of this app and reload.</p>;
  if (!loaded) return <p className="p-8 text-muted">Loading your library…</p>;
  if (route.page === 'perform') return <Perform key={`${route.setId}`} setId={route.setId} item={route.item} />;
  return (
    <div className="flex min-h-full">
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
    <nav className="w-44 shrink-0 bg-ink px-4 py-7 text-white sm:w-[230px]" aria-label="Main">
      <p className="mb-6 px-3 font-mono text-2xl font-bold tracking-tight">DJW</p>
      <ul className="space-y-1.5">
        {items.map(([label, target, active]) => (
          <li key={label}>
            <button
              type="button"
              aria-current={active ? 'page' : undefined}
              className={`w-full rounded-md px-3 py-2.5 text-left text-[17px] ${active ? 'bg-accent' : 'hover:bg-white/10'}`}
              onClick={() => go(target)}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
