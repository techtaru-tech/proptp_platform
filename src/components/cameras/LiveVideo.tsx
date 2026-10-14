import { useEffect, useRef, useState } from 'react';
import { RefreshCw, VideoOff } from 'lucide-react';

/**
 * Plays whatever a camera's live address serves, by what the address looks like:
 *
 *  - `.m3u8`: an HLS stream. Safari plays it natively; every other browser needs hls.js, which is
 *    loaded only when a stream is actually shown.
 *  - `.mp4` / `.webm`: a plain video.
 *  - MJPEG or a still-image feed: an <img>.
 *  - anything else: a player page (a gateway's own viewer), in an <iframe>.
 *
 * A camera's own RTSP address is not playable in a browser, which is why the site has a gateway
 * (tools/site-gateway) that turns it into one of the above.
 */
export type LiveState = 'loading' | 'playing' | 'error';

const kindOf = (url: string): 'hls' | 'video' | 'image' | 'page' => {
  const path = url.split('?')[0].toLowerCase();
  if (/\.m3u8$/.test(path)) return 'hls';
  if (/\.(mp4|webm)$/.test(path)) return 'video';
  if (/(\.mjpe?g|mjpeg|\.jpe?g|\.png)$/.test(path)) return 'image';
  return 'page';
};

export function LiveVideo({ url, onState }: { url: string; onState?: (s: LiveState) => void }) {
  const kind = kindOf(url);
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<LiveState>('loading');
  const [attempt, setAttempt] = useState(0);

  const report = (s: LiveState) => {
    setState(s);
    onState?.(s);
  };

  useEffect(() => {
    if (kind !== 'hls') return;
    const el = video.current;
    if (!el) return;
    report('loading');
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;

    (async () => {
      // hls.js first: current Chrome also claims to play HLS natively, but its own player stumbles on
      // live playlists. Only where hls.js has nothing to run on (iPhone Safari) is the native one used.
      const { default: Hls } = await import('hls.js');
      if (cancelled) return;
      if (!Hls.isSupported()) {
        if (el.canPlayType('application/vnd.apple.mpegurl')) el.src = url;
        else report('error');
        return;
      }
      const player = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 8, manifestLoadingMaxRetry: 3, levelLoadingMaxRetry: 3 });
      hls = player;
      player.loadSource(url);
      player.attachMedia(el);
      player.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        console.warn('[live] fatal', data.type, data.details);
        // A dropped connection is worth one more try before calling the camera down.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && attempt < 2) player.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) player.recoverMediaError();
        else report('error');
      });
    })().catch(() => report('error'));

    return () => {
      cancelled = true;
      hls?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, kind, attempt]);

  const retry = () => {
    report('loading');
    setAttempt((n) => n + 1);
  };

  if (kind === 'page') {
    return <iframe src={url} title="Live view" className="h-full w-full bg-black" allow="autoplay; fullscreen" onLoad={() => report('playing')} />;
  }
  if (kind === 'image') {
    return <img key={attempt} src={url} alt="Live view" className="h-full w-full bg-black object-contain" onLoad={() => report('playing')} onError={() => report('error')} />;
  }

  return (
    <div className="relative h-full w-full bg-black">
      <video
        key={`${url}-${attempt}`}
        ref={video}
        src={kind === 'video' ? url : undefined}
        muted
        autoPlay
        playsInline
        controls={kind === 'video'}
        className="h-full w-full object-contain"
        onPlaying={() => report('playing')}
        onError={(e) => { console.warn('[live] video error', (e.currentTarget as HTMLVideoElement).error?.code, (e.currentTarget as HTMLVideoElement).error?.message); report('error'); }}
      />
      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 text-center text-sm text-white">
          <VideoOff size={22} />
          <p>The camera is not answering.</p>
          <button onClick={retry} className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25 focus-ring">
            <RefreshCw size={12} /> Try again
          </button>
        </div>
      )}
    </div>
  );
}
