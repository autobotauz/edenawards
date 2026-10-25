import { useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { LoginRequired } from '../../components/Login';
import { EmptyState, Spinner } from '../../components/ui';

const TABS = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/seasons', label: 'Seasons' },
  { to: '/admin/moderation', label: 'Moderation' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/audit', label: 'Activity log' },
];

/** Client-side gate for a nicer UX only; every admin API call is authorized on the server. */
export function AdminLayout() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <LoginRequired action="open the admin area" returnTo="/admin" />;
  if (!user.isAdmin)
    return <EmptyState title="Administrators only">Your Discord account is not on the Eden Awards admin list.</EmptyState>;
  return (
    <div>
      <h1 className="text-3xl">Admin</h1>
      <nav aria-label="Admin" className="mt-4 mb-8 flex gap-1 overflow-x-auto border-b border-rim/60">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `-mb-px shrink-0 border-b-2 px-3 py-2 no-underline ${
                isActive ? 'border-gold text-gold-bright' : 'border-transparent text-parchment-dim hover:text-parchment'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

/** Two-step inline confirmation for consequential actions (no blocking browser dialogs). */
export function ConfirmButton({
  label,
  confirmLabel,
  message,
  onConfirm,
  className = 'btn-ghost',
  disabled,
}: {
  label: string;
  confirmLabel?: string;
  message: ReactNode;
  onConfirm: () => Promise<void> | void;
  className?: string;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking)
    return (
      <button type="button" className={className} onClick={() => setAsking(true)} disabled={disabled}>
        {label}
      </button>
    );
  return (
    <span role="group" aria-label="Confirm action" className="inline-flex flex-wrap items-center gap-2 rounded-md border border-warn/50 bg-warn/10 px-3 py-2">
      <span className="text-sm text-warn">{message}</span>
      <button
        type="button"
        className="btn-gold px-3 py-1 text-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {confirmLabel ?? label}
      </button>
      <button type="button" className="btn-ghost px-3 py-1 text-sm" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'warn' | 'ok' }) {
  return (
    <div className="rounded-md bg-night-deep/60 px-4 py-3">
      <div className={`font-display text-2xl tabular-nums ${tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-gold-bright'}`}>
        {value}
      </div>
      <div className="text-sm text-mist">{label}</div>
    </div>
  );
}
