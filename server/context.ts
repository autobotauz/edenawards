import type { Context } from 'hono';
import type { Db } from './db';
import type { Config } from './config';
import type { UserRow } from './lib/mappers';

export interface Deps {
  db: Db;
  config: Config;
  now: () => number;
  fetch: typeof fetch;
}

export interface SessionInfo {
  idHash: string;
  csrfToken: string;
  user: UserRow;
  isAdmin: boolean;
}

export type AppEnv = {
  Variables: {
    deps: Deps;
    session: SessionInfo | null;
  };
};

export type Ctx = Context<AppEnv>;
