import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Category, Season } from '../../../shared/types';
import { PHASE_LABEL } from '../../../shared/season';
import { ErrorState, Spinner, useToast } from '../../components/ui';
import { ApiError, del, patch, post } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { formatDateTime, fromLocalInput, localZoneName, toLocalInput } from '../../lib/time';
import { ConfirmButton } from './common';
import { SeasonResultsPreview } from './ResultsPreview';

export function AdminSeasons() {
  const { data, loading, error, reload } = useApi<{ seasons: Season[] }>('/api/admin/seasons');
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorState error={error ?? new Error('No data')} onRetry={reload} />;
  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl">Seasons</h2>
        <Link to="/admin/seasons/new" className="btn-gold">
          Create season
        </Link>
      </div>
      <ul className="mt-5 divide-y divide-rim/50 panel">
        {data.seasons.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <Link to={`/admin/seasons/${s.id}`} className="font-display text-lg text-parchment">
                {s.name}
              </Link>
              <p className="text-sm text-mist">
                Submissions {formatDateTime(s.submissionStartsAt)} to {formatDateTime(s.submissionEndsAt)}
              </p>
            </div>
            <span className="text-gold">{s.isPublished ? PHASE_LABEL[s.phase] : 'Draft'}</span>
          </li>
        ))}
        {!data.seasons.length && <li className="px-5 py-6 text-parchment-dim">No seasons yet. Create the first one.</li>}
      </ul>
    </div>
  );
}

type TimeKey = 'submissionStartsAt' | 'submissionEndsAt' | 'votingStartsAt' | 'votingEndsAt' | 'resultsPublishAt';
const TIME_FIELDS: Array<[TimeKey, string, string]> = [
  ['submissionStartsAt', 'Submissions open', 'When players can start entering videos.'],
  ['submissionEndsAt', 'Submissions close', 'New entries are refused from this moment.'],
  ['votingStartsAt', 'Voting opens', 'May overlap with submissions if you like.'],
  ['votingEndsAt', 'Voting closes', 'Votes become final and immutable.'],
  ['resultsPublishAt', 'Results publish', 'Earliest time results can appear publicly (they also need “Publish results”).'],
];

interface SeasonForm {
  name: string;
  description: string;
  times: Record<TimeKey, string>;
  allowSelfVote: boolean;
  copyCategoriesFrom: string;
}

function defaultForm(): SeasonForm {
  const day = 86_400_000;
  const start = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + day);
  const at = (d: number) => toLocalInput(new Date(start.getTime() + d * day).toISOString());
  return {
    name: '',
    description: '',
    times: { submissionStartsAt: at(0), submissionEndsAt: at(14), votingStartsAt: at(14), votingEndsAt: at(21), resultsPublishAt: at(22) },
    allowSelfVote: false,
    copyCategoriesFrom: '',
  };
}

function formFromSeason(s: Season): SeasonForm {
  return {
    name: s.name,
    description: s.description,
    times: {
      submissionStartsAt: toLocalInput(s.submissionStartsAt),
      submissionEndsAt: toLocalInput(s.submissionEndsAt),
      votingStartsAt: toLocalInput(s.votingStartsAt),
      votingEndsAt: toLocalInput(s.votingEndsAt),
      resultsPublishAt: toLocalInput(s.resultsPublishAt),
    },
    allowSelfVote: s.allowSelfVote,
    copyCategoriesFrom: '',
  };
}

export function SeasonEditorPage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const { data, loading, error, reload } = useApi<{ season: Season; categories: Array<Category & { videoCount: number; approvedCount: number; voteCount: number }> }>(
    isNew ? null : `/api/admin/seasons/${id}`,
  );
  if (!isNew && loading) return <Spinner />;
  if (!isNew && (error || !data)) return <ErrorState error={error ?? new Error('Not found')} onRetry={reload} />;
  return (
    <div className="space-y-10">
      <SeasonDetails season={data?.season ?? null} onSaved={reload} />
      {data && (
        <>
          <PublishControls season={data.season} onChange={reload} />
          <CategoryManager season={data.season} categories={data.categories} onChange={reload} />
          <SeasonResultsPreview season={data.season} />
        </>
      )}
    </div>
  );
}

function SeasonDetails({ season, onSaved }: { season: Season | null; onSaved: () => void }) {
  const [form, setForm] = useState<SeasonForm>(() => (season ? formFromSeason(season) : defaultForm()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const seasons = useApi<{ seasons: Season[] }>(season ? null : '/api/admin/seasons');
  useEffect(() => {
    if (season) setForm(formFromSeason(season));
  }, [season]);

  const now = Date.now();
  const locked = (k: TimeKey) => !!season && Date.parse(season[k]) <= now;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const payload: Record<string, unknown> = { name: form.name, description: form.description, allowSelfVote: form.allowSelfVote };
    for (const [k] of TIME_FIELDS) {
      // Only send times that actually changed (inputs have minute precision).
      if (season && (locked(k) || form.times[k] === toLocalInput(season[k]))) continue;
      payload[k] = fromLocalInput(form.times[k]);
    }
    if (!season && form.copyCategoriesFrom) payload.copyCategoriesFrom = Number(form.copyCategoriesFrom);
    if (season && season.votingState !== 'upcoming') delete payload.allowSelfVote;
    try {
      if (season) {
        await patch(`/api/admin/seasons/${season.id}`, payload);
        toast('Season saved.');
        onSaved();
      } else {
        const res = await post<{ season: Season }>('/api/admin/seasons', payload);
        toast('Season created as a draft.');
        navigate(`/admin/seasons/${res.season.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(Object.keys(err.fields).length ? err.fields : { form: err.message });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel space-y-6 p-6" aria-label="Season details" noValidate>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl">{season ? season.name : 'New season'}</h2>
        {season && <span className="text-gold">{season.isPublished ? PHASE_LABEL[season.phase] : 'Draft'}</span>}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <label className="md:col-span-2">
          <span className="label">Name</span>
          <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Eden Season 5 Awards" aria-invalid={!!errors.name} />
          {errors.name && <span className="error-text block">{errors.name}</span>}
        </label>
        <label className="md:col-span-2">
          <span className="label">Description</span>
          <textarea className="field min-h-24" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          {errors.description && <span className="error-text block">{errors.description}</span>}
        </label>
      </div>

      <fieldset>
        <legend className="label">Schedule</legend>
        <p className="hint">Times are in your time zone ({localZoneName()}) and stored in UTC. Times that have already passed are locked.</p>
        <div className="mt-3 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {TIME_FIELDS.map(([k, label, hint]) => (
            <label key={k}>
              <span className="label text-sm">{label}</span>
              <input
                type="datetime-local"
                className="field"
                value={form.times[k]}
                disabled={locked(k)}
                onChange={(e) => setForm({ ...form, times: { ...form.times, [k]: e.target.value } })}
                aria-invalid={!!errors[k]}
              />
              <span className={errors[k] ? 'error-text block' : 'hint block'}>{errors[k] ?? (locked(k) ? 'Locked: already passed.' : hint)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-[var(--color-gold)]"
          checked={form.allowSelfVote}
          disabled={!!season && season.votingState !== 'upcoming'}
          onChange={(e) => setForm({ ...form, allowSelfVote: e.target.checked })}
        />
        <span>
          Allow players to vote for their own entries
          <span className="hint block">Off by default. Locked once voting opens.</span>
          {errors.allowSelfVote && <span className="error-text block">{errors.allowSelfVote}</span>}
        </span>
      </label>

      {!season && (
        <div className="max-w-md">
          <label htmlFor="copy-from" className="label">
            Copy categories from
          </label>
          <select id="copy-from" className="field" value={form.copyCategoriesFrom} onChange={(e) => setForm({ ...form, copyCategoriesFrom: e.target.value })}>
            <option value="">Start with no categories</option>
            {seasons.data?.seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="hint block">Copies names, descriptions and order only — never entries or votes.</span>
        </div>
      )}

      {errors.form && (
        <p role="alert" className="text-danger">
          {errors.form}
        </p>
      )}
      <button className="btn-gold" disabled={busy}>
        {busy ? 'Saving…' : season ? 'Save changes' : 'Create draft season'}
      </button>
    </form>
  );
}

function PublishControls({ season, onChange }: { season: Season; onChange: () => void }) {
  const toast = useToast();
  const [error, setError] = useState('');
  const run = async (body: Record<string, boolean>, message: string) => {
    setError('');
    try {
      await patch(`/api/admin/seasons/${season.id}`, body);
      toast(message);
      onChange();
    } catch (err) {
      const e = err as ApiError;
      setError(Object.values(e.fields ?? {})[0] ?? e.message);
    }
  };
  return (
    <section className="panel p-6" aria-labelledby="publish-h">
      <h2 id="publish-h" className="text-2xl">
        Publishing
      </h2>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="font-sans text-lg font-bold tracking-normal">Season visibility</h3>
          <p className="mt-1 text-parchment-dim">
            {season.isPublished ? 'Published: players can see this season.' : 'Draft: only admins can see this season.'}
          </p>
          <div className="mt-3">
            {season.isPublished ? (
              <ConfirmButton
                label="Unpublish season"
                message="Hide this season from players?"
                disabled={season.phase !== 'upcoming'}
                onConfirm={() => run({ isPublished: false }, 'Season unpublished.')}
              />
            ) : (
              <ConfirmButton
                label="Publish season"
                className="btn-gold"
                message="Announce this season to everyone?"
                onConfirm={() => run({ isPublished: true }, 'Season published.')}
              />
            )}
          </div>
        </div>
        <div>
          <h3 className="font-sans text-lg font-bold tracking-normal">Results</h3>
          <p className="mt-1 text-parchment-dim">
            {season.resultsVisible
              ? 'Public now.'
              : season.resultsPublished
                ? `Approved. They go public ${formatDateTime(season.resultsPublishAt)}.`
                : season.votingState === 'closed'
                  ? 'Hidden. Rehearse the presentation, then publish when you announce the winners.'
                  : 'Available after voting closes.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {season.resultsPublished ? (
              <ConfirmButton
                label="Unpublish results"
                message="Hide results from the public again?"
                onConfirm={() => run({ resultsPublished: false }, 'Results hidden.')}
              />
            ) : (
              <ConfirmButton
                label="Publish results"
                className="btn-gold"
                disabled={season.votingState !== 'closed' || !season.isPublished}
                message="Make winners public at the scheduled time?"
                onConfirm={() => run({ resultsPublished: true }, 'Results published.')}
              />
            )}
            <Link to={`/present/${season.id}`} className="btn-ghost">
              Open presentation
            </Link>
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-4 text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

type AdminCategory = Category & { videoCount: number; approvedCount: number; voteCount: number };

function CategoryManager({ season, categories, onChange }: { season: Season; categories: AdminCategory[]; onChange: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const canAdd = Date.now() < Date.parse(season.submissionEndsAt);
  const canToggle = season.votingState === 'upcoming';

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setError('');
    try {
      await fn();
      toast(message);
      onChange();
    } catch (err) {
      const e = err as ApiError;
      setError(Object.values(e.fields ?? {})[0] ?? e.message);
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    const other = categories[index + dir];
    const cur = categories[index];
    if (!other) return;
    void act(async () => {
      await patch(`/api/admin/categories/${cur.id}`, { displayOrder: other.displayOrder === cur.displayOrder ? cur.displayOrder + dir : other.displayOrder });
      await patch(`/api/admin/categories/${other.id}`, { displayOrder: cur.displayOrder });
    }, 'Order updated.');
  };

  return (
    <section className="panel p-6" aria-labelledby="cats-h">
      <h2 id="cats-h" className="text-2xl">
        Award categories
      </h2>
      <p className="mt-1 text-parchment-dim">
        Renaming is always safe: entries and votes stay attached. Categories can be enabled or disabled until voting opens, and
        deleted only while empty.
      </p>
      <ul className="mt-5 space-y-3">
        {categories.map((c, i) => (
          <CategoryRow
            key={c.id}
            category={c}
            first={i === 0}
            last={i === categories.length - 1}
            canToggle={canToggle}
            onMove={(d) => move(i, d)}
            onSave={(body) => act(() => patch(`/api/admin/categories/${c.id}`, body), 'Category saved.')}
            onDelete={() => act(() => del(`/api/admin/categories/${c.id}`), 'Category deleted.')}
          />
        ))}
        {!categories.length && <li className="text-parchment-dim">No categories yet.</li>}
      </ul>
      {canAdd ? (
        <form
          className="mt-6 grid gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await post('/api/admin/categories', { seasonId: season.id, name, description });
              setName('');
              setDescription('');
            }, 'Category added.');
          }}
        >
          <label>
            <span className="label text-sm">New category name</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Best Healer Save" />
          </label>
          <label>
            <span className="label text-sm">Description</span>
            <input className="field" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <button className="btn-gold" disabled={!name.trim()}>
            Add category
          </button>
        </form>
      ) : (
        <p className="hint mt-4">Submissions have closed, so no new categories can be added.</p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function CategoryRow({
  category,
  first,
  last,
  canToggle,
  onMove,
  onSave,
  onDelete,
}: {
  category: AdminCategory;
  first: boolean;
  last: boolean;
  canToggle: boolean;
  onMove: (dir: -1 | 1) => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description);

  return (
    <li className={`rounded-md border border-rim/60 bg-night-deep/40 p-4 ${category.enabled ? '' : 'opacity-70'}`}>
      {editing ? (
        <form
          className="grid gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            await onSave({ name, description });
            setEditing(false);
          }}
        >
          <label>
            <span className="label text-sm">Name</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span className="label text-sm">Description</span>
            <input className="field" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button className="btn-gold">Save</button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-bold">
              {category.name} {!category.enabled && <span className="text-sm font-normal text-mist">(disabled)</span>}
            </p>
            <p className="text-sm text-mist">
              {category.approvedCount} approved of {category.videoCount} entries, {category.voteCount} votes
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost px-2 py-1 text-sm" onClick={() => onMove(-1)} disabled={first} aria-label={`Move ${category.name} up`}>
              ↑
            </button>
            <button type="button" className="btn-ghost px-2 py-1 text-sm" onClick={() => onMove(1)} disabled={last} aria-label={`Move ${category.name} down`}>
              ↓
            </button>
            <button type="button" className="btn-ghost px-3 py-1 text-sm" onClick={() => setEditing(true)}>
              Rename
            </button>
            {canToggle && (
              <button type="button" className="btn-ghost px-3 py-1 text-sm" onClick={() => void onSave({ enabled: !category.enabled })}>
                {category.enabled ? 'Disable' : 'Enable'}
              </button>
            )}
            {category.videoCount === 0 && (
              <ConfirmButton
                label="Delete"
                className="btn-danger px-3 py-1 text-sm"
                message={`Delete “${category.name}”?`}
                onConfirm={onDelete}
              />
            )}
          </div>
        </div>
      )}
    </li>
  );
}
