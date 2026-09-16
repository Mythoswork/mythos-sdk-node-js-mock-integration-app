import type { MythosSession } from '@mythos-work/sdk';

const SESSION_CACHE_TTL_MS = 30 * 60 * 1000;

interface CachedSession {
  session: MythosSession;
  expiresAt: number;
}

const sessions = new Map<string, CachedSession>();

export function rememberMythosSession(launchToken: string, session: MythosSession): void {
  sessions.set(launchToken, {
    session,
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
  });
}

export function getMythosSession(launchToken: string): MythosSession | null {
  const cached = sessions.get(launchToken);
  if (!cached || cached.expiresAt <= Date.now()) {
    sessions.delete(launchToken);
    return null;
  }
  return cached.session;
}
