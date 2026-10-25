import { useState } from 'react';
import type { PublicUser } from '../../../shared/types';
import { Avatar, ErrorState, Spinner, useToast } from '../../components/ui';
import { ApiError, patch } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { formatDate, formatDateTime } from '../../lib/time';
import { ConfirmButton } from './common';

type AdminUser = PublicUser & { isAdmin: boolean; isBanned: boolean; submissions: number; votes: number; createdAt: string };

export function AdminUsers() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, loading, error, reload, setData } = useApi<{ users: AdminUser[]; total: number }>(
    `/api/admin/users?pageSize=50${query ? `&q=${encodeURIComponent(query)}` : ''}`,
  );
  const toast = useToast();

  const setBan = async (u: AdminUser, banned: boolean) => {
    try {
      await patch(`/api/admin/users/${u.discordId}`, { banned });
      setData((d) => (d ? { ...d, users: d.users.map((x) => (x.discordId === u.discordId ? { ...x, isBanned: banned } : x)) } : d));
      toast(banned ? `${u.displayName} is banned from submitting and voting.` : `${u.displayName} is unbanned.`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not update the user.', 'error');
    }
  };

  return (
    <div>
      <p className="max-w-2xl text-parchment-dim">
        Banning stops a player from submitting or voting, signs them out, and removes their votes from the count. Use it for
        alt accounts and abuse. It can be undone.
      </p>
      <form
        className="mt-4 flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <input className="field" type="search" placeholder="Username or Discord ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
        <button className="btn-ghost">Search</button>
      </form>
      <div className="mt-6">
        {loading && !data ? (
          <Spinner />
        ) : error || !data ? (
          <ErrorState error={error ?? new Error('No data')} onRetry={reload} />
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left">
              <thead className="text-sm text-mist">
                <tr className="border-b border-rim/60">
                  <th className="px-4 py-3 font-medium">Player</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium">Entries</th>
                  <th className="px-4 py-3 font-medium">Votes</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.discordId} className="border-b border-rim/40 last:border-0">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        <Avatar user={u} size={26} />
                        <span>
                          {u.displayName}
                          <span className="block text-xs text-mist">
                            {u.username} · {u.discordId}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm" title={formatDateTime(u.createdAt)}>
                      {formatDate(u.createdAt)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{u.submissions}</td>
                    <td className="px-4 py-3 tabular-nums">{u.votes}</td>
                    <td className="px-4 py-3 text-sm">
                      {u.isAdmin ? <span className="text-gold">Admin</span> : u.isBanned ? <span className="text-danger">Banned</span> : 'Active'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!u.isAdmin &&
                        (u.isBanned ? (
                          <button type="button" className="btn-ghost px-3 py-1 text-sm" onClick={() => void setBan(u, false)}>
                            Unban
                          </button>
                        ) : (
                          <ConfirmButton
                            label="Ban"
                            className="btn-danger px-3 py-1 text-sm"
                            message={`Ban ${u.displayName}?`}
                            onConfirm={() => setBan(u, true)}
                          />
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.users.length && <p className="px-4 py-6 text-parchment-dim">No players found.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  target: string | null;
  details: string | null;
  createdAt: string;
}

const ACTIONS: Record<string, string> = {
  'season.create': 'created a season',
  'season.update': 'updated a season',
  'category.create': 'added a category',
  'category.update': 'updated a category',
  'category.delete': 'deleted a category',
  'video.moderate': 'moderated a submission',
  'user.ban': 'banned a player',
  'user.unban': 'unbanned a player',
};

export function AdminAudit() {
  const { data, loading, error, reload } = useApi<{ entries: AuditEntry[] }>('/api/admin/audit?pageSize=100');
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorState error={error ?? new Error('No data')} onRetry={reload} />;
  return (
    <div>
      <p className="text-parchment-dim">Every administrative change is recorded here.</p>
      <ul className="panel mt-4 divide-y divide-rim/40">
        {data.entries.map((e) => (
          <li key={e.id} className="px-4 py-3">
            <p>
              <strong>{e.actor}</strong> {ACTIONS[e.action] ?? e.action}
              {e.target && <span className="text-mist"> ({e.target})</span>}
            </p>
            <p className="text-sm text-mist">
              {formatDateTime(e.createdAt)}
              {e.details && <span className="ml-2 break-all font-mono text-xs">{e.details}</span>}
            </p>
          </li>
        ))}
        {!data.entries.length && <li className="px-4 py-6 text-parchment-dim">No admin activity yet.</li>}
      </ul>
    </div>
  );
}
