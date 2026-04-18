'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
}

export default function SelectReposPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const accessToken = searchParams.get('access_token');
  const refreshToken = searchParams.get('refresh_token');
  const expiresIn = searchParams.get('expires_in');
  const scope = searchParams.get('scope');

  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      setError('Missing access token');
      return;
    }

    const fetchRepos = async () => {
      try {
        const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'agx',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        });

        if (!res.ok) {
          throw new Error(`Failed to fetch repos: ${res.status}`);
        }

        const data = await res.json();
        setRepos(data);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch repos');
        setLoading(false);
      }
    };

    fetchRepos();
  }, [accessToken]);

  const handleToggle = (id: number) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  };

  const handleContinue = () => {
    const repoNames = repos
      .filter((r) => selected.has(r.id))
      .map((r) => r.full_name)
      .join(',');

    const params = new URLSearchParams({
      access_token: accessToken!,
      repos: repoNames,
    });

    if (refreshToken) {
      params.set('refresh_token', refreshToken);
    }
    if (expiresIn) {
      params.set('expires_in', expiresIn);
    }
    if (scope) {
      params.set('scope', scope);
    }

    router.push(`/api/trackers/github/token-receive?${params.toString()}`);
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <h1>Loading repositories...</h1>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <h1>Error</h1>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h1>Select GitHub Repositories</h1>
      <p>Choose which repositories you want to track with agx</p>

      <div style={styles.repoList}>
        {repos.length === 0 ? (
          <p>No repositories found</p>
        ) : (
          repos.map((repo) => (
            <label key={repo.id} style={styles.repoItem}>
              <input
                type="checkbox"
                checked={selected.has(repo.id)}
                onChange={() => handleToggle(repo.id)}
              />
              <span style={styles.repoName}>{repo.full_name}</span>
              {repo.private && <span style={styles.badge}>Private</span>}
            </label>
          ))
        )}
      </div>

      <div style={styles.footer}>
        <p>{selected.size} repository(ies) selected</p>
        <button
          onClick={handleContinue}
          disabled={selected.size === 0}
          style={styles.button}
        >
          Continue with {selected.size} {selected.size === 1 ? 'repo' : 'repos'}
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '600px',
    margin: '40px auto',
    padding: '20px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  } as const,
  repoList: {
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    marginTop: '20px',
    maxHeight: '400px',
    overflowY: 'auto' as const,
  } as const,
  repoItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px',
    borderBottom: '1px solid #e5e7eb',
    cursor: 'pointer',
  } as const,
  repoName: {
    marginLeft: '8px',
    flex: 1,
  } as const,
  badge: {
    fontSize: '12px',
    backgroundColor: '#f3f4f6',
    padding: '2px 6px',
    borderRadius: '4px',
    marginLeft: '8px',
  } as const,
  footer: {
    marginTop: '20px',
    paddingTop: '20px',
    borderTop: '1px solid #e5e7eb',
    textAlign: 'center' as const,
  } as const,
  button: {
    backgroundColor: '#000',
    color: '#fff',
    padding: '10px 20px',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    marginTop: '10px',
  } as const,
};
