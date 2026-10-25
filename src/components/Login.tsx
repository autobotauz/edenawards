import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';

export function DiscordIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18 18 0 0 0-5.5 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.8 19.8 0 0 0 6 3l1.3-2a12.7 12.7 0 0 1-2-1l.5-.4a14 14 0 0 0 12.1 0l.5.4-2 1 1.3 2a19.7 19.7 0 0 0 6-3c.5-5.2-.8-9.7-3.5-13.7ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.4 8 10.4s2.2 1.1 2.2 2.5-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.5 2.2-2.5 2.2 1.1 2.2 2.5-1 2.4-2.2 2.4Z" />
    </svg>
  );
}

export function LoginButton({ returnTo, className = '', label }: { returnTo?: string; className?: string; label?: string }) {
  const { config, loginUrl } = useAuth();
  if (!config.discordEnabled) {
    return config.devLoginEnabled ? (
      <Link to={`/login?returnTo=${encodeURIComponent(returnTo ?? window.location.pathname)}`} className={`btn-gold ${className}`}>
        {label ?? 'Log in'}
      </Link>
    ) : (
      <span className="text-sm text-mist">Login is not configured yet.</span>
    );
  }
  return (
    <a href={loginUrl(returnTo)} className={`btn bg-[#5865F2] text-white hover:bg-[#4752c4] ${className}`}>
      <DiscordIcon />
      {label ?? 'Log in with Discord'}
    </a>
  );
}

const SAMPLE_USERS = [
  ['100000000000000001', 'Eden Admin'],
  ['100000000000000002', 'Thane of Hibernia'],
  ['100000000000000003', 'Albion Knight'],
  ['100000000000000004', 'Midgard Skald'],
] as const;

/** Development-only sign-in (rendered only when the server reports DEV_LOGIN=true). */
export function DevLogin({ onDone }: { onDone?: () => void }) {
  const { config, devLogin } = useAuth();
  const [id, setId] = useState<string>(SAMPLE_USERS[1][0]);
  const [name, setName] = useState<string>(SAMPLE_USERS[1][1]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!config.devLoginEnabled) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await devLogin(id.trim(), name.trim());
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id="dev-login" onSubmit={submit} className="panel border-dashed border-warn/50 p-4" aria-label="Development login">
      <h2 className="font-sans text-base font-bold tracking-normal text-warn">Development login</h2>
      <p className="hint">
        Discord login is replaced by this form while <code>DEV_LOGIN=true</code>. Pick a sample user or type any numeric ID.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {SAMPLE_USERS.map(([uid, uname]) => (
          <button
            key={uid}
            type="button"
            className={`btn-ghost px-3 py-1 text-sm ${id === uid ? 'border-gold text-gold-bright' : ''}`}
            onClick={() => {
              setId(uid);
              setName(uname);
            }}
          >
            {uname}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label>
          <span className="label text-sm">Discord ID</span>
          <input className="field" value={id} onChange={(e) => setId(e.target.value)} inputMode="numeric" />
        </label>
        <label>
          <span className="label text-sm">Username</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn-gold" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}

/** Shown in place of a form or button when the visitor must log in first. */
export function LoginRequired({ action, returnTo }: { action: string; returnTo?: string }) {
  return (
    <div className="space-y-4">
      <div className="panel p-6">
        <h2 className="text-xl">Log in to {action}</h2>
        <p className="mt-2 text-parchment-dim">
          Eden Awards uses your Discord account so every player gets one fair vote per category. We only read your Discord
          username and avatar.
        </p>
        <div className="mt-4">
          <LoginButton returnTo={returnTo} />
        </div>
      </div>
      <DevLogin />
    </div>
  );
}
