import { useEffect, useState } from 'react';
import { Search, Download, Loader2, ExternalLink, AlertCircle } from 'lucide-react';

interface YouTubeResult {
  id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  url: string;
  viewCount?: number;
}

const isLink = (value: string) => /^(https?:\/\/|(www\.|m\.)?(youtube\.com|youtu\.be)\/)/i.test(value);

interface YouTubeSearchProps {
  onDownloadComplete: (filePath: string, fileName: string) => void;
}

export function YouTubeSearch({ onDownloadComplete }: YouTubeSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [helper, setHelper] = useState<'checking' | 'ready' | 'missing-binary' | 'server-down'>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('http://localhost:3001/api/youtube/check');
        if (!response.ok) {
          if (!cancelled) setHelper('server-down');
          return;
        }
        const data = await response.json();
        if (!cancelled) setHelper(data.available ? 'ready' : 'missing-binary');
      } catch {
        if (!cancelled) setHelper('server-down');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = query.trim();
  const linkMode = isLink(value);
  const busy = searching || downloading === 'direct';

  const handleSearch = async () => {
    setSearching(true);
    setError(null);
    setResults([]);

    try {
      const response = await fetch(
        `http://localhost:3001/api/youtube/search?q=${encodeURIComponent(query)}`
      );
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Search failed');
      }

      const data = await response.json();
      setResults(data.results || []);
      
      if (!data.results || data.results.length === 0) {
        setError('Search returned no results. YouTube may require authentication. Try pasting a YouTube link instead.');
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : '';
      setError(detail
        ? `${detail} You can paste a YouTube link instead.`
        : 'Search unavailable. Paste a YouTube link instead.');
    } finally {
      setSearching(false);
    }
  };

  const handleDirectDownload = async () => {
    setDownloading('direct');
    setError(null);

    try {
      const response = await fetch('http://localhost:3001/api/youtube/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: value })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Download failed');
      }

      const data = await response.json();
      onDownloadComplete(data.filePath, data.fileName);
      setQuery('');
    } catch (err: any) {
      setError(err.message || 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value) return;
    void (linkMode ? handleDirectDownload() : handleSearch());
  };

  const handleDownload = async (result: YouTubeResult) => {
    setDownloading(result.id);
    setError(null);

    try {
      const response = await fetch('http://localhost:3001/api/youtube/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: result.id, url: result.url })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Download failed');
      }

      const data = await response.json();
      onDownloadComplete(data.filePath, data.fileName);
    } catch (err: any) {
      setError(err.message || 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatViews = (views?: number) => {
    if (!views) return '';
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M views`;
    if (views >= 1000) return `${(views / 1000).toFixed(1)}K views`;
    return `${views} views`;
  };

  if (helper === 'checking') {
    return (
      <div className="youtube-search p-6 text-gray-400 text-sm">Checking the YouTube helper…</div>
    );
  }

  if (helper === 'server-down' || helper === 'missing-binary') {
    const title = helper === 'server-down' ? 'YouTube helper is not running' : 'yt-dlp is not installed';
    const body = helper === 'server-down'
      ? 'Start the app with npm run dev so search and download can reach the helper on port 3001.'
      : 'Install yt-dlp, then restart the helper. Local audio files still import from the file tab.';
    return (
      <div className="youtube-search p-6 bg-gray-800 rounded-lg">
        <div className="flex items-start gap-3 p-4 bg-yellow-900 bg-opacity-30 border border-yellow-700 rounded-lg">
          <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-yellow-400 font-semibold mb-1">{title}</h3>
            <p className="text-yellow-200 text-sm mb-2">{body}</p>
            {helper === 'missing-binary' && (
              <code className="text-xs bg-gray-900 px-2 py-1 rounded text-yellow-300">
                brew install yt-dlp
              </code>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="youtube-search">
      <form onSubmit={handleSubmit} className="mb-6">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search YouTube or paste a link"
              aria-label="Search YouTube or paste a link"
              className="w-full px-4 py-3 pl-11 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
              disabled={busy}
            />
            <Search className="w-5 h-5 text-gray-400 absolute left-3 top-3.5" />
          </div>
          <button
            type="submit"
            disabled={busy || !value}
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium inline-flex items-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {searching ? 'Searching...' : 'Downloading...'}
              </>
            ) : linkMode ? (
              <>
                <Download className="w-5 h-5" />
                Download
              </>
            ) : (
              <>
                <Search className="w-5 h-5" />
                Search
              </>
            )}
          </button>
        </div>
      </form>

      <div className="text-xs text-gray-400 mb-4 flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        Personal use only. Ensure you have rights to download content.
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900 bg-opacity-30 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((result) => (
            <div
              key={result.id}
              className="youtube-result flex gap-4 p-4 bg-gray-800 rounded-lg hover:bg-gray-750 transition-colors"
            >
              <img
                src={result.thumbnail}
                alt={result.title}
                className="w-40 h-24 object-cover rounded flex-shrink-0"
              />
              
              <div className="flex-1 min-w-0">
                <h3 className="text-white font-medium mb-1 truncate">
                  {result.title}
                </h3>
                <p className="text-gray-400 text-sm mb-2">{result.channel}</p>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>{formatDuration(result.duration)}</span>
                  {result.viewCount && (
                    <span>{formatViews(result.viewCount)}</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2 justify-center">
                <button
                  onClick={() => handleDownload(result)}
                  disabled={downloading === result.id}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium text-sm inline-flex items-center gap-2 whitespace-nowrap"
                >
                  {downloading === result.id ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Downloading...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Download
                    </>
                  )}
                </button>
                
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors text-sm inline-flex items-center gap-2 justify-center"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
