import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { PublicUser } from '../../shared/types';
import type { ApiError } from '../lib/api';

/** Three hanging realm pennants: Albion, Hibernia, Midgard. Purely decorative. */
export function Pennants({ className = '' }: { className?: string }) {
  const colors = ['var(--color-albion)', 'var(--color-hibernia)', 'var(--color-midgard)'];
  return (
    <svg viewBox="0 0 120 70" className={className} aria-hidden="true">
      <line x1="0" y1="4" x2="120" y2="4" stroke="var(--color-gold-deep)" strokeWidth="2" />
      {colors.map((c, i) => (
        <g key={c} transform={`translate(${10 + i * 38} 4)`}>
          <path d="M0 0h24v52l-12-10-12 10Z" fill={c} />
          <path d="M0 0h24v52l-12-10-12 10Z" fill="none" stroke="var(--color-gold)" strokeWidth="1.5" />
        </g>
      ))}
    </svg>
  );
}

export function Avatar({ user, size = 32 }: { user: Pick<PublicUser, 'avatarUrl' | 'displayName'>; size?: number }) {
  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        width={size}
        height={size}
        className="rounded-full border border-rim bg-keep-raised"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center rounded-full border border-rim bg-keep-raised font-display text-gold"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {user.displayName.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-10 text-mist">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-rim border-t-gold" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  return (
    <div role="alert" className="panel border-danger/40 p-5">
      <p className="text-danger">{error.message}</p>
      {onRetry && (
        <button type="button" className="btn-ghost mt-3" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="panel px-6 py-10 text-center">
      <h3 className="text-xl">{title}</h3>
      {children && <div className="mx-auto mt-2 max-w-prose text-parchment-dim">{children}</div>}
    </div>
  );
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-3xl sm:text-4xl">{title}</h1>
      {children && <div className="mt-2 max-w-2xl text-parchment-dim">{children}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- toasts */

interface Toast {
  id: number;
  message: string;
  tone: 'ok' | 'error';
}
const ToastCtx = createContext<(message: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto rounded-md border px-4 py-2 shadow-lg ${
              t.tone === 'error' ? 'border-danger/60 bg-night-deep text-danger' : 'border-gold/60 bg-night-deep text-parchment'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
