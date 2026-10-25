import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LoginRequired } from '../../components/Login';
import { EmptyState, ErrorState, Spinner } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';
import type { AdminResults } from '../admin/ResultsPreview';
import { buildSlides, categoryStart, nextCategoryStart, slideLabel, type Slide } from './slides';
import { Stage } from './Stage';

interface ShowState {
  index: number;
  /** Incremented to (re)play the animation of the current slide. */
  replay: number;
  /** Incremented when the presenter starts the winning video on screen. */
  play: number;
}

type Message = { type: 'state'; state: ShowState } | { type: 'hello' };

/**
 * Keeps the presenter console and the audience screen in sync across browser windows
 * (same browser, same origin) using BroadcastChannel. Either window can drive.
 */
export function useShow(seasonId: string, total: number) {
  const [state, setState] = useState<ShowState>({ index: 0, replay: 0, play: 0 });
  const channel = useRef<BroadcastChannel | null>(null);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(`eden-present-${seasonId}`);
    channel.current = ch;
    ch.onmessage = (e: MessageEvent<Message>) => {
      if (e.data.type === 'state') setState(e.data.state);
      if (e.data.type === 'hello') ch.postMessage({ type: 'state', state: latest.current } satisfies Message);
    };
    ch.postMessage({ type: 'hello' } satisfies Message);
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [seasonId]);

  const update = useCallback(
    (fn: (s: ShowState) => ShowState) => {
      setState((prev) => {
        const next = fn(prev);
        next.index = Math.max(0, Math.min(total - 1, next.index));
        channel.current?.postMessage({ type: 'state', state: next } satisfies Message);
        return next;
      });
    },
    [total],
  );

  return {
    state,
    goTo: (index: number) => update((s) => ({ index, replay: s.replay + 1, play: 0 })),
    next: () => update((s) => ({ index: s.index + 1, replay: s.replay + 1, play: 0 })),
    prev: () => update((s) => ({ index: s.index - 1, replay: s.replay + 1, play: 0 })),
    replay: () => update((s) => ({ ...s, replay: s.replay + 1, play: 0 })),
    playVideo: () => update((s) => ({ ...s, play: s.play + 1 })),
  };
}

function useKeyboard(handlers: { next: () => void; prev: () => void; replay: () => void; fullscreen?: () => void; first: () => void; last: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      // On a focused button, Space/Enter already "click" it; don't also advance the show.
      if (target?.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) {
        e.preventDefault();
        handlers.next();
      } else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) {
        e.preventDefault();
        handlers.prev();
      } else if (e.key === 'r' || e.key === 'R') handlers.replay();
      else if ((e.key === 'f' || e.key === 'F') && handlers.fullscreen) handlers.fullscreen();
      else if (e.key === 'Home') handlers.first();
      else if (e.key === 'End') handlers.last();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
}

interface Loaded {
  seasonId: string;
  data: AdminResults;
  slides: Slide[];
}

/** Loads the private results once and only renders the show for administrators. */
function Gate({ children }: { children: (loaded: Loaded) => React.ReactNode }) {
  const { seasonId = '' } = useParams();
  const { user, loading: authLoading } = useAuth();
  const res = useApi<AdminResults>(user?.isAdmin ? `/api/admin/seasons/${seasonId}/results` : null);
  const slides = useMemo<Slide[]>(() => (res.data ? buildSlides(res.data) : []), [res.data]);
  if (authLoading) return <Spinner />;
  if (!user) return <LoginRequired action="present the awards" />;
  if (!user.isAdmin) return <EmptyState title="Administrators only">The presentation is only available to organizers.</EmptyState>;
  if (res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (res.loading || !res.data) return <Spinner label="Loading results…" />;
  return <>{children({ seasonId, data: res.data, slides })}</>;
}

/** Audience screen: open in its own window and share it on Discord. No controls are shown. */
export function PresentScreen() {
  return <Gate>{(loaded) => <ScreenInner {...loaded} />}</Gate>;
}

function ScreenInner({ seasonId, data, slides }: Loaded) {
  const show = useShow(seasonId, slides.length);
  const [hint, setHint] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 4000);
    return () => clearTimeout(t);
  }, []);
  useKeyboard({
    next: show.next,
    prev: show.prev,
    replay: show.replay,
    first: () => show.goTo(0),
    last: () => show.goTo(slides.length - 1),
    fullscreen: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    },
  });
  const slide = slides[show.state.index];
  return (
    <div className="fixed inset-0 z-40 cursor-none bg-night-deep" data-testid="audience-screen">
      <div key={`${show.state.index}-${show.state.replay}`} className="h-full w-full">
        <Stage slide={slide} results={data} playKey={show.state.play} />
      </div>
      {hint && (
        <p className="pointer-events-none absolute bottom-[6vh] left-1/2 -translate-x-1/2 rounded bg-night/80 px-4 py-2 text-sm text-mist">
          Press F for full screen. Use the presenter window or the arrow keys to advance.
        </p>
      )}
    </div>
  );
}

/** Presenter console: preview, step controls and category jump list. */
export function PresentConsole() {
  return <Gate>{(loaded) => <ConsoleInner {...loaded} />}</Gate>;
}

function ConsoleInner({ seasonId, data, slides }: Loaded) {
  const show = useShow(seasonId, slides.length);
  useKeyboard({ next: show.next, prev: show.prev, replay: show.replay, first: () => show.goTo(0), last: () => show.goTo(slides.length - 1) });
  const slide = slides[show.state.index];
  const nextSlide = slides[show.state.index + 1];
  const openScreen = () => window.open(`/present/${seasonId}/screen`, `eden-screen-${seasonId}`, 'popup,width=1280,height=720');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl">Presentation</h1>
          <p className="text-parchment-dim">{data.season.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-gold" onClick={openScreen}>
            Open audience screen
          </button>
          <Link to={`/admin/seasons/${seasonId}`} className="btn-ghost">
            Back to season
          </Link>
        </div>
      </div>

      {!data.public && (
        <p role="note" className="rounded-md border border-warn/50 bg-warn/10 px-4 py-3 text-warn">
          Rehearsal mode: results are not public yet. Only admins can see these slides. {data.final ? '' : 'Voting is still open, so the standings may change.'}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          <div className="aspect-video overflow-hidden rounded-lg border border-rim">
            <div className="h-full w-full" key={`${show.state.index}-${show.state.replay}`}>
              <Stage slide={slide} results={data} playKey={show.state.play} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Presentation controls">
            <button type="button" className="btn-ghost" onClick={show.prev} disabled={show.state.index === 0}>
              Previous
            </button>
            <button type="button" className="btn-gold px-6" onClick={show.next} disabled={show.state.index >= slides.length - 1}>
              {nextSlide ? `Next: ${slideLabel(nextSlide, data)}` : 'End of show'}
            </button>
            <button type="button" className="btn-ghost" onClick={show.replay}>
              Replay step
            </button>
            <button type="button" className="btn-ghost" onClick={() => show.goTo(nextCategoryStart(slides, show.state.index))}>
              Skip to next award
            </button>
            {slide.kind === 'video' && (
              <button type="button" className="btn-ghost" onClick={show.playVideo}>
                Play winning video on screen
              </button>
            )}
          </div>
          <p className="mt-3 text-sm text-mist">
            Step {show.state.index + 1} of {slides.length}: {slideLabel(slide, data)}. Keys: → or Space next, ← back, R replay,
            Home/End first/last.
          </p>
        </div>

        <nav aria-label="Jump to award" className="panel p-4">
          <h2 className="font-sans text-base font-bold tracking-normal">Awards</h2>
          <ol className="mt-3 space-y-1">
            <li>
              <button type="button" className={`w-full rounded px-2 py-1 text-left ${show.state.index === 0 ? 'text-gold-bright' : 'text-parchment-dim hover:text-parchment'}`} onClick={() => show.goTo(0)}>
                Opening
              </button>
            </li>
            {data.categories.map((c, i) => {
              const start = categoryStart(slides, i);
              const end = nextCategoryStart(slides, start);
              const current = show.state.index >= start && show.state.index < end;
              return (
                <li key={c.category.id}>
                  <button
                    type="button"
                    className={`w-full rounded px-2 py-1 text-left ${current ? 'bg-keep-raised text-gold-bright' : 'text-parchment-dim hover:text-parchment'}`}
                    onClick={() => show.goTo(start)}
                  >
                    {c.category.name}
                    {c.winners.length > 1 && <span className="ml-2 text-xs text-warn">tie</span>}
                  </button>
                </li>
              );
            })}
            <li>
              <button type="button" className="w-full rounded px-2 py-1 text-left text-parchment-dim hover:text-parchment" onClick={() => show.goTo(slides.length - 1)}>
                Closing
              </button>
            </li>
          </ol>
        </nav>
      </div>
    </div>
  );
}
