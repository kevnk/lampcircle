interface BackLinkProps {
  onClick: () => void;
}

export function BackLink({ onClick }: BackLinkProps) {
  return (
    <button type="button" className="text-sm text-gray-300" onClick={onClick}>
      ← Library
    </button>
  );
}

interface PlayButtonProps {
  isPlaying: boolean;
  onToggle: () => void;
}

export function PlayButton({ isPlaying, onToggle }: PlayButtonProps) {
  return (
    <button
      type="button"
      className="px-6 py-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-lg font-medium"
      onClick={onToggle}
    >
      {isPlaying ? 'Pause' : 'Play'}
    </button>
  );
}
