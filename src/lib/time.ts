/** Date display helpers. Times are stored in UTC; shown in the viewer's zone with the zone named. */

export function formatDateTime(isoString: string, timeZone?: string): string {
  const d = new Date(isoString);
  const fmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  });
  return fmt.format(d);
}

export function formatUtc(isoString: string): string {
  const d = new Date(isoString);
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(isoString));
}

export interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
}

export function remaining(targetIso: string, now: number): Remaining {
  const total = Math.max(0, Date.parse(targetIso) - now);
  const s = Math.floor(total / 1000);
  return {
    total,
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

/** Server-minus-client clock offset, so countdowns follow server time even if the PC clock is wrong. */
export function clockOffset(serverIso: string | undefined | null, clientNow = Date.now()): number {
  if (!serverIso) return 0;
  const server = Date.parse(serverIso);
  return Number.isFinite(server) ? server - clientNow : 0;
}

/** Converts an ISO string to the value of a datetime-local input in the viewer's zone. */
export function toLocalInput(isoString: string): string {
  const d = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function localZoneName(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
