import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

type YouTubePlayerInstance = {
  destroy: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  getIframe: () => HTMLIFrameElement;
};

type YouTubeApi = {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => YouTubePlayerInstance;
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export type YouTubePlayerHandle = {
  pause: () => void;
  play: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (rate: number) => void;
  requestFullscreen: () => void;
};

type Props = {
  videoId: string;
  startAt: number;
  onReady: (duration: number) => void;
  onTimeUpdate: (seconds: number) => void;
  onPlaying: () => void;
  onPaused: () => void;
  onBuffering: () => void;
  onEnded: () => void;
  onError: () => void;
};

let youtubeApiPromise: Promise<YouTubeApi> | null = null;

function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube 播放器初始化失败'));
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('无法加载 YouTube 播放器'));
    document.head.append(script);
  });
  return youtubeApiPromise;
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, Props>(function YouTubePlayer(props, ref) {
  const elementRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const propsRef = useRef(props);

  useEffect(() => { propsRef.current = props; }, [props]);

  useImperativeHandle(ref, () => ({
    pause: () => playerRef.current?.pauseVideo(),
    play: () => playerRef.current?.playVideo(),
    seek: (seconds) => playerRef.current?.seekTo(Math.max(0, seconds), true),
    setVolume: (volume) => playerRef.current?.setVolume(Math.round(Math.max(0, Math.min(1, volume)) * 100)),
    setPlaybackRate: (rate) => playerRef.current?.setPlaybackRate(rate),
    requestFullscreen: () => { void playerRef.current?.getIframe().requestFullscreen?.(); },
  }), []);

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    void loadYouTubeApi().then((api) => {
      if (disposed || !elementRef.current) return;
      const player = new api.Player(elementRef.current, {
        width: '100%', height: '100%', videoId: props.videoId,
        playerVars: { autoplay: 0, controls: 1, enablejsapi: 1, origin: window.location.origin, playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            if (disposed) return;
            playerRef.current = player;
            if (propsRef.current.startAt > 0) player.seekTo(propsRef.current.startAt, true);
            propsRef.current.onReady(player.getDuration() || 0);
            timer = window.setInterval(() => propsRef.current.onTimeUpdate(player.getCurrentTime() || 0), 250);
          },
          onStateChange: (event: { data: number }) => {
            if (event.data === 1) propsRef.current.onPlaying();
            else if (event.data === 2) propsRef.current.onPaused();
            else if (event.data === 3) propsRef.current.onBuffering();
            else if (event.data === 0) propsRef.current.onEnded();
          },
          onError: () => propsRef.current.onError(),
        },
      });
      playerRef.current = player;
    }).catch(() => { if (!disposed) propsRef.current.onError(); });
    return () => {
      disposed = true;
      if (timer) window.clearInterval(timer);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [props.videoId]);

  return <div ref={elementRef} className="youtube-player" aria-label="YouTube 视频播放器" />;
});
