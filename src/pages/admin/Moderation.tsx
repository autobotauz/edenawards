import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ModerationStatus, Season, Video } from '../../../shared/types';
import { Avatar, EmptyState, ErrorState, Spinner, useToast } from '../../components/ui';
import { StatusBadge, VideoPlayer } from '../../components/Video';
import { ApiError, patch } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { formatDateTime } from '../../lib/time';

type AdminVideo = Video & { votes: number; moderationStatus: ModerationStatus };
const FILTERS: Array<[string, string]> = [
  ['pending', 'Awaiting review'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['hidden', 'Hidden'],
  ['', 'All'],
];

export function AdminModeration() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'pending';
  const seasonId = params.get('seasonId') ?? '';
  const q = params.get('q') ?? '';
  const page = Number(params.get('page') ?? '1') || 1;
  const seasons = useApi<{ seasons: Season[] }>('/api/admin/seasons');
  const query = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (status) query.set('status', status);
  if (seasonId) query.set('seasonId', seasonId);
  if (q) query.set('q', q);
  const { data, loading, error, reload, setData } = useApi<{ videos: AdminVideo[]; total: number; pageSize: number }>(`/api/admin/videos?${query}`);
  const [search, setSearch] = useState(q);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    if (key === 'status' && !value) next.set('status', '');
    setParams(next);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-4">
        <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {FILTERS.map(([value, label]) => (
            <button
              key={label}
              role="tab"
              aria-selected={status === value}
              type="button"
              onClick={() => update('status', value)}
              className={`btn-ghost px-3 py-1.5 text-sm ${status === value ? 'border-gold text-gold-bright' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="ml-auto">
          <span className="label text-sm">Season</span>
          <select className="field" value={seasonId} onChange={(e) => update('seasonId', e.target.value)}>
            <option value="">All seasons</option>
            {seasons.data?.seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update('q', search.trim());
          }}
        >
          <label>
            <span className="label text-sm">Search title or player</span>
            <input className="field" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </form>
      </div>

      <div className="mt-6">
        {loading && !data ? (
          <Spinner />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !data?.videos.length ? (
          <EmptyState title={status === 'pending' ? 'Nothing waiting for review' : 'No submissions match'}>
            {status === 'pending' ? 'New submissions that need a decision will appear here.' : 'Try another filter.'}
          </EmptyState>
        ) : (
          <>
            <p className="mb-3 text-sm text-mist">{data.total} submissions</p>
            <ul className="space-y-4">
              {data.videos.map((v) => (
                <ModerationItem
                  key={v.id}
                  video={v}
                  onUpdated={(nv) => setData((d) => (d ? { ...d, videos: d.videos.map((x) => (x.id === nv.id ? { ...x, ...nv } : x)) } : d))}
                />
              ))}
            </ul>
            {data.total > data.pageSize && (
              <div className="mt-6 flex items-center gap-3">
                <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => update('page', String(page - 1))}>
                  Previous
                </button>
                <span className="text-mist">
                  Page {page} of {Math.ceil(data.total / data.pageSize)}
                </span>
                <button type="button" className="btn-ghost" disabled={page * data.pageSize >= data.total} onClick={() => update('page', String(page + 1))}>
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ModerationItem({ video, onUpdated }: { video: AdminVideo; onUpdated: (v: AdminVideo) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const decide = async (status: ModerationStatus, verb: string) => {
    if ((status === 'rejected' || status === 'hidden') && !reason.trim()) {
      setError('Add a short reason so the player knows why.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await patch<{ video: AdminVideo }>(`/api/admin/videos/${video.id}/moderation`, { status, reason: reason.trim() || undefined });
      onUpdated({ ...video, ...res.video });
      toast(`${verb} “${video.title}”.`);
      setReason('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="panel grid gap-5 p-4 md:grid-cols-[20rem_minmax(0,1fr)]">
      <VideoPlayer video={video} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-sans text-lg font-bold tracking-normal">
              <Link to={`/videos/${video.id}`} className="text-parchment">
                {video.title}
              </Link>
            </h3>
            <p className="flex flex-wrap items-center gap-2 text-sm text-parchment-dim">
              <Avatar user={video.author} size={20} /> {video.author.displayName} ({video.author.username}) in {video.categoryName}
            </p>
          </div>
          <StatusBadge status={video.moderationStatus} />
        </div>
        <p className="mt-2 text-sm text-mist">
          Submitted {formatDateTime(video.createdAt)} · {video.votes} votes ·{' '}
          <a href={video.canonicalUrl} target="_blank" rel="noopener noreferrer nofollow">
            {video.canonicalUrl}
          </a>
        </p>
        {video.moderationReason && (
          <p className="mt-2 rounded border border-rim/60 bg-night-deep/50 px-3 py-2 text-sm">
            <span className="text-mist">Note: </span>
            {video.moderationReason}
          </p>
        )}
        {video.votes > 0 && video.moderationStatus === 'approved' && (
          <p className="mt-2 text-sm text-warn">
            This entry has {video.votes} votes. Rejecting or hiding it removes them from the count; those voters will be asked
            to vote again.
          </p>
        )}
        <label className="mt-3 block">
          <span className="label text-sm">Reason (shown to the player when rejecting or hiding)</span>
          <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {video.moderationStatus !== 'approved' && (
            <button type="button" className="btn-gold" disabled={busy} onClick={() => decide('approved', 'Approved')}>
              Approve
            </button>
          )}
          {video.moderationStatus !== 'rejected' && (
            <button type="button" className="btn-danger" disabled={busy} onClick={() => decide('rejected', 'Rejected')}>
              Reject
            </button>
          )}
          {video.moderationStatus !== 'hidden' && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => decide('hidden', 'Hid')}>
              Hide
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
