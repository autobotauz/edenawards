import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Avatar, useToast } from './ui';
import { LoginButton } from './Login';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/submit', label: 'Submit video' },
  { to: '/vote', label: 'Browse & vote' },
  { to: '/results', label: 'Results' },
];

const LOGIN_MESSAGES: Record<string, string> = {
  invalid_state: 'Login expired or was started in another tab. Please try again.',
  cancelled: 'Discord login was cancelled.',
  failed: 'Discord login failed. Please try again.',
};

export function Layout() {
  const { user, logout, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const toast = useToast();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    const login = params.get('login');
    if (login) {
      toast(LOGIN_MESSAGES[login] ?? 'Login failed.', 'error');
      params.delete('login');
      setParams(params, { replace: true });
    }
  }, [params, setParams, toast]);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-2 no-underline transition-colors ${
      isActive ? 'text-gold-bright' : 'text-parchment-dim hover:text-parchment'
    }`;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-night focus:p-2">
        Skip to content
      </a>
      <div className="realm-rule" />
      <header className="border-b border-rim/60 bg-night-deep/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link to="/" className="text-parchment no-underline hover:no-underline">
            <span className="font-display text-xl tracking-wider">Eden Awards</span>
          </Link>

          <nav aria-label="Main" className="ml-6 hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={linkClass}>
                {n.label}
              </NavLink>
            ))}
            {user?.isAdmin && (
              <NavLink to="/admin" className={linkClass}>
                Admin
              </NavLink>
            )}
          </nav>

          <div className="ml-auto hidden items-center gap-3 md:flex">
            {loading ? null : user ? (
              <>
                <span className="flex items-center gap-2 text-sm">
                  <Avatar user={user} size={28} />
                  <span>{user.displayName}</span>
                </span>
                <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => void logout()}>
                  Log out
                </button>
              </>
            ) : (
              <LoginButton className="px-3 py-1.5 text-sm" />
            )}
          </div>

          <button
            type="button"
            className="btn-ghost ml-auto px-3 py-1.5 md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((o) => !o)}
          >
            Menu
          </button>
        </div>

        {open && (
          <nav id="mobile-nav" aria-label="Main" className="border-t border-rim/60 px-4 py-3 md:hidden">
            <div className="flex flex-col">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={linkClass}>
                  {n.label}
                </NavLink>
              ))}
              {user?.isAdmin && (
                <NavLink to="/admin" className={linkClass}>
                  Admin
                </NavLink>
              )}
            </div>
            <div className="mt-3 border-t border-rim/60 pt-3">
              {user ? (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Avatar user={user} size={28} />
                    {user.displayName}
                  </span>
                  <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => void logout()}>
                    Log out
                  </button>
                </div>
              ) : (
                <LoginButton className="w-full" />
              )}
            </div>
          </nav>
        )}
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">
        <Outlet />
      </main>

      <footer className="border-t border-rim/60 py-6 text-sm text-mist">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4">
          <p>Eden Awards is a fan-run community event for the Eden Dark Age of Camelot server.</p>
          <p>Not affiliated with Broadsword or Electronic Arts.</p>
        </div>
      </footer>
    </div>
  );
}
