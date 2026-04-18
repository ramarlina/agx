'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  updated_at: string;
  owner: { login: string; avatar_url: string };
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export default function SelectReposPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState<string | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [login, setLogin] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'public' | 'private'>('all');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const urlToken = searchParams.get('access_token');
    const storedToken = typeof window !== 'undefined' ? sessionStorage.getItem('github_token') : null;
    const token = urlToken || storedToken;

    if (!token) {
      setError('Missing access token');
      setLoading(false);
      return;
    }

    if (urlToken) {
      const refresh = searchParams.get('refresh_token');
      const expires = searchParams.get('expires_in');
      const scopes = searchParams.get('scope');
      const sess = searchParams.get('session');
      const lg = searchParams.get('login');
      const expAt = searchParams.get('expires_at');

      setAccessToken(urlToken);
      setRefreshToken(refresh);
      setExpiresIn(expires);
      setScope(scopes);
      setSession(sess);
      setLogin(lg);
      setExpiresAt(expAt);

      sessionStorage.setItem('github_token', urlToken);
      if (refresh) sessionStorage.setItem('github_refresh_token', refresh);
      if (expires) sessionStorage.setItem('github_expires_in', expires);
      if (scopes) sessionStorage.setItem('github_scope', scopes);
      if (sess) sessionStorage.setItem('github_session', sess);
      if (lg) sessionStorage.setItem('github_login', lg);
      if (expAt) sessionStorage.setItem('github_expires_at', expAt);

      window.history.replaceState({}, '', '/integrations/github/select-repos');
    } else {
      setAccessToken(token);
      setRefreshToken(sessionStorage.getItem('github_refresh_token'));
      setExpiresIn(sessionStorage.getItem('github_expires_in'));
      setScope(sessionStorage.getItem('github_scope'));
      setSession(sessionStorage.getItem('github_session'));
      setLogin(sessionStorage.getItem('github_login'));
      setExpiresAt(sessionStorage.getItem('github_expires_at'));
    }
  }, [searchParams]);

  useEffect(() => {
    if (!accessToken) return;

    const fetchRepos = async () => {
      try {
        const headers = {
          Authorization: `token ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'agx',
          'X-GitHub-Api-Version': '2022-11-28',
        };

        const all: GithubRepo[] = [];
        let page = 1;
        while (page <= 10) {
          const url = `https://api.github.com/user/repos?per_page=100&page=${page}&visibility=all&affiliation=owner,collaborator,organization_member&sort=updated`;
          const res = await fetch(url, { headers });
          if (!res.ok) throw new Error(`Failed to fetch repos: ${res.status}`);
          const batch = (await res.json()) as GithubRepo[];
          all.push(...batch);
          if (batch.length < 100) break;
          page++;
        }

        setRepos(all);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch repos');
        setLoading(false);
      }
    };

    fetchRepos();
  }, [accessToken]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return repos.filter((r) => {
      if (filter === 'public' && r.private) return false;
      if (filter === 'private' && !r.private) return false;
      if (!q) return true;
      return (
        r.full_name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [repos, query, filter]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filtered.forEach((r) => next.delete(r.id));
      } else {
        filtered.forEach((r) => next.add(r.id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const handleContinue = async () => {
    if (!accessToken || selected.size === 0) return;
    setSubmitting(true);

    const picked = repos.filter((r) => selected.has(r.id));
    try {
      await Promise.all(
        picked.map((r) =>
          fetch('/api/github/repos', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              owner: r.owner.login,
              name: r.name,
              private: r.private,
            }),
          }),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save repos');
      setSubmitting(false);
      return;
    }

    const repoNames = picked.map((r) => r.full_name).join(',');

    const params = new URLSearchParams({
      access_token: accessToken,
      repos: repoNames,
    });
    if (refreshToken) params.set('refresh_token', refreshToken);
    if (expiresIn) params.set('expires_in', expiresIn);
    if (scope) params.set('scope', scope);
    if (session) params.set('session', session);
    if (login) params.set('login', login);
    if (expiresAt) params.set('expires_at', expiresAt);
    if (scope) params.set('scopes', scope);

    router.push(`/api/trackers/github/token-receive?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <header className="mb-6">
          <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] mb-2">
            <span>GitHub</span>
            <span>·</span>
            <span>Connect</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Select repositories</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Pick the repos you want agx to track. You can change this later in project settings.
          </p>
          {scope && (
            <p className="text-[11px] text-[var(--muted-foreground)] mt-2 font-mono">
              Token scopes: {scope}
            </p>
          )}
        </header>

        {error ? (
          <div className="rounded-lg border border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] text-[var(--status-failed)] px-4 py-3 text-sm">
            {error}
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <div className="relative flex-1">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search repositories..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--input)] text-sm focus:outline-none focus:border-[var(--primary)] focus:bg-[var(--input-focus)] transition-colors"
                />
              </div>
              <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1">
                {(['all', 'public', 'private'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1 text-xs rounded-md capitalize transition-colors ${
                      filter === f
                        ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                        : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between mb-2 text-xs text-[var(--muted-foreground)]">
              <button
                onClick={toggleAllFiltered}
                disabled={filtered.length === 0}
                className="hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
              >
                {allFilteredSelected ? 'Deselect all' : 'Select all'}
                {query || filter !== 'all' ? ` (${filtered.length} shown)` : ''}
              </button>
              {selected.size > 0 && (
                <button
                  onClick={clearSelection}
                  className="hover:text-[var(--foreground)] transition-colors"
                >
                  Clear selection
                </button>
              )}
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--card-bg)] overflow-hidden">
              <div className="max-h-[60vh] overflow-y-auto">
                {loading ? (
                  <div className="divide-y divide-[var(--border)]">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="px-4 py-3 flex items-center gap-3 animate-pulse">
                        <div className="w-4 h-4 rounded bg-[var(--muted)]" />
                        <div className="w-6 h-6 rounded-full bg-[var(--muted)]" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3 w-1/3 rounded bg-[var(--muted)]" />
                          <div className="h-2 w-2/3 rounded bg-[var(--muted)]" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
                    {repos.length === 0 ? 'No repositories found on your account.' : 'No repos match your search.'}
                  </div>
                ) : (
                  <ul className="divide-y divide-[var(--border)]">
                    {filtered.map((repo) => {
                      const isSelected = selected.has(repo.id);
                      return (
                        <li key={repo.id}>
                          <label
                            className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${
                              isSelected ? 'bg-[var(--primary-muted)]' : 'hover:bg-[var(--item-hover-bg)]'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggle(repo.id)}
                              className="mt-1 accent-[var(--primary)]"
                            />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={repo.owner.avatar_url}
                              alt=""
                              className="w-6 h-6 rounded-full mt-0.5 flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium truncate">{repo.full_name}</span>
                                {repo.private && (
                                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">
                                    Private
                                  </span>
                                )}
                              </div>
                              {repo.description && (
                                <p className="text-xs text-[var(--muted-foreground)] mt-0.5 line-clamp-1">
                                  {repo.description}
                                </p>
                              )}
                              <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
                                Updated {relativeTime(repo.updated_at)}
                              </div>
                            </div>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-[var(--muted-foreground)]">
                {selected.size} selected
              </span>
              <button
                onClick={handleContinue}
                disabled={selected.size === 0 || submitting}
                className="px-4 py-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[var(--primary-foreground)] text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Connecting...' : `Continue with ${selected.size} ${selected.size === 1 ? 'repo' : 'repos'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
