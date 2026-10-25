import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Video } from '../../shared/types';
import { parseVideoUrl, PLATFORM_LABEL } from '../../shared/video';
import { LoginRequired } from '../components/Login';
import { EmptyState, ErrorState, PageTitle, Spinner, useToast } from '../components/ui';
import { StatusBadge } from '../components/Video';
import { ApiError, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/hooks';
import { useCurrentSeason } from '../lib/season';
import { formatDateTime } from '../lib/time';

export function Submit() {
  const { user, loading: authLoading } = useAuth();
  const { season, categories, loading } = useCurrentSeason();

  if (loading || authLoading) return <Spinner />;
  if (!season) return <EmptyState title="No season is running">Submissions open when the next season is announced.</EmptyState>;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div>
        <PageTitle title="Submit a video">
          Enter your best moment from {season.name}. Paste a YouTube or Twitch link, name it and choose the award.
        </PageTitle>
        {season.submissionState === 'upcoming' && (
          <EmptyState title="Submissions haven't opened yet">They open {formatDateTime(season.submissionStartsAt)}.</EmptyState>
        )}
        {season.submissionState === 'closed' && (
          <EmptyState title="Submissions are closed">
            {season.votingState === 'closed' ? (
              'This season’s competition is over.'
            ) : (
              <>
                You can still <Link to="/vote">browse the entries and vote</Link>.
              </>
            )}
          </EmptyState>
        )}
        {season.submissionState === 'open' &&
          (user ? (
            user.isBanned ? (
              <EmptyState title="Your account can't submit">Your account has been suspended from participating.</EmptyState>
            ) : (
              <SubmitForm seasonName={season.name} categories={categories} />
            )
          ) : (
            <LoginRequired action="submit a video" returnTo="/submit" />
          ))}
      </div>
      {user && <MySubmissions seasonId={season.id} />}
    </div>
  );
}

interface FormProps {
  seasonName: string;
  categories: { id: number; name: string; description: string }[];
}

function SubmitForm({ categories }: FormProps) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Video | null>(null);
  const toast = useToast();

  const parsed = useMemo(() => (url.trim() ? parseVideoUrl(url) : null), [url]);
  const selected = categories.find((c) => String(c.id) === categoryId);

  if (created) {
    return (
      <div className="panel border-gold/60 p-6" role="status">
        <h2 className="text-2xl">Your video is entered</h2>
        <p className="mt-2 text-parchment-dim">
          “{created.title}” is in <strong className="text-parchment">{created.categoryName}</strong>.{' '}
          {created.moderationStatus === 'approved'
            ? 'It was verified automatically and is already open for votes.'
            : 'A moderator will review it shortly; it appears on the voting page once approved.'}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link to={`/videos/${created.id}`} className="btn-gold">
            View your entry
          </Link>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setCreated(null);
              setUrl('');
              setTitle('');
            }}
          >
            Submit another video
          </button>
        </div>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!parsed || !parsed.ok) local.url = parsed && !parsed.ok ? parsed.error : 'Please paste a YouTube or Twitch link.';
    if (title.trim().length < 3) local.title = 'Give your video a title of at least 3 characters.';
    if (!categoryId) local.categoryId = 'Please choose an award category.';
    setErrors(local);
    setFormError('');
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const res = await post<{ video: Video }>('/api/videos', { url, title, categoryId: Number(categoryId) });
      setCreated(res.video);
      toast('Video submitted.');
      window.dispatchEvent(new Event('eden:submissions-changed'));
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        if (!Object.keys(err.fields).length) setFormError(err.message);
      } else setFormError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="panel space-y-6 p-6" aria-label="Submit a video">
      <div>
        <label htmlFor="url" className="label">
          Video link
        </label>
        <input
          id="url"
          className="field"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.youtube.com/watch?v=… or https://www.twitch.tv/videos/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-invalid={!!errors.url}
          aria-describedby="url-hint"
        />
        <p id="url-hint" className={errors.url ? 'error-text' : 'hint'} aria-live="polite">
          {errors.url ??
            (parsed?.ok
              ? `Recognized: ${PLATFORM_LABEL[parsed.video.platform]} ${parsed.video.videoId}`
              : parsed
                ? parsed.error
                : 'YouTube videos and Shorts, Twitch VODs and Twitch clips.')}
        </p>
      </div>

      <div>
        <label htmlFor="title" className="label">
          Title
        </label>
        <input
          id="title"
          className="field"
          maxLength={100}
          placeholder="Shadowblade 1v3 at Emain"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={!!errors.title}
          aria-describedby="title-hint"
        />
        <p id="title-hint" className={errors.title ? 'error-text' : 'hint'}>
          {errors.title ?? `${title.trim().length}/100 characters`}
        </p>
      </div>

      <div>
        <label htmlFor="category" className="label">
          Award category
        </label>
        <select
          id="category"
          className="field"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-invalid={!!errors.categoryId}
          aria-describedby="category-hint"
        >
          <option value="">Choose a category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <p id="category-hint" className={errors.categoryId ? 'error-text' : 'hint'}>
          {errors.categoryId ?? selected?.description ?? 'Each video goes into one category.'}
        </p>
      </div>

      {formError && (
        <p role="alert" className="rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-danger">
          {formError}
        </p>
      )}

      <button className="btn-gold px-6 py-2.5 text-lg" disabled={busy}>
        {busy ? 'Submitting…' : 'Submit video'}
      </button>
    </form>
  );
}

function MySubmissions({ seasonId }: { seasonId: number }) {
  const { data, loading, error, reload } = useApi<{ videos: Video[] }>(`/api/videos/mine?seasonId=${seasonId}`);
  useEventReload('eden:submissions-changed', reload);

  return (
    <aside aria-labelledby="mine">
      <h2 id="mine" className="text-xl">
        Your submissions
      </h2>
      <div className="mt-4">
        {loading && !data ? (
          <Spinner />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !data?.videos.length ? (
          <p className="text-parchment-dim">You haven’t submitted anything this season yet.</p>
        ) : (
          <ul className="space-y-3">
            {data.videos.map((v) => (
              <li key={v.id} className="panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/videos/${v.id}`} className="font-bold text-parchment">
                    {v.title}
                  </Link>
                  {v.moderationStatus && <StatusBadge status={v.moderationStatus} />}
                </div>
                <p className="mt-1 text-sm text-mist">{v.categoryName}</p>
                {v.moderationStatus === 'rejected' && v.moderationReason && (
                  <p className="mt-1 text-sm text-danger">Reason: {v.moderationReason}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function useEventReload(event: string, reload: () => void) {
  useEffect(() => {
    window.addEventListener(event, reload);
    return () => window.removeEventListener(event, reload);
  }, [event, reload]);
}
