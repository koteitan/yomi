import { logBluesky } from '../utils';

const PUBLIC_API = 'https://public.api.bsky.app';
const BSKY_API = 'https://bsky.social';

export interface BlueskyProfile {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

export interface BlueskyPost {
  uri: string;
  cid: string;
  author: BlueskyProfile;
  text: string;
  createdAt: string;
}

interface Session {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
}

const SESSION_KEY = 'bluesky_session';

let session: Session | null = null;

// Try to restore session from localStorage on load
try {
  const saved = localStorage.getItem(SESSION_KEY);
  if (saved) {
    session = JSON.parse(saved);
    logBluesky(' session restored for:', session?.handle);
  }
} catch (e) {
  // Ignore errors
}

/**
 * Login to Bluesky with handle and app password
 * @param force - Force new login even if session exists
 * Retries with exponential backoff on rate limit (429) errors
 */
export async function login(handle: string, appPassword: string, force = false): Promise<boolean> {
  // Use existing session if not forced
  if (!force && session && session.handle === handle) {
    logBluesky(' using existing session for:', handle);
    return true;
  }

  const MAX_RETRIES = 5;
  let delay = 1000; // Start with 1 second

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${BSKY_API}/xrpc/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: handle, password: appPassword }),
      });

      if (res.ok) {
        session = await res.json();
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        logBluesky(' logged in as:', session?.handle);
        return true;
      }

      // Retry on rate limit (429) or server errors (5xx)
      if (res.status === 429 || res.status >= 500) {
        if (attempt < MAX_RETRIES) {
          logBluesky(` login failed: ${res.status}, retrying in ${delay / 1000}s (${attempt}/${MAX_RETRIES})`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          continue;
        }
      }

      logBluesky(' login failed:', res.status);
      return false;
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        logBluesky(` login error, retrying in ${delay / 1000}s (${attempt}/${MAX_RETRIES}):`, e);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      console.error('[bluesky] login error:', e);
      return false;
    }
  }

  return false;
}

/**
 * Logout from Bluesky
 */
export function logout(): void {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}

/**
 * Check if logged in
 */
export function isLoggedIn(): boolean {
  return session !== null;
}

/**
 * Refresh the session using refreshJwt
 */
export async function refreshSession(): Promise<boolean> {
  if (!session?.refreshJwt) {
    logBluesky(' refreshSession: no refresh token');
    return false;
  }

  try {
    logBluesky(' refreshSession: refreshing...');
    const res = await fetch(`${BSKY_API}/xrpc/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.refreshJwt}`,
      },
    });

    if (!res.ok) {
      logBluesky(' refreshSession failed:', res.status);
      // Clear invalid session
      session = null;
      localStorage.removeItem(SESSION_KEY);
      return false;
    }

    session = await res.json();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    logBluesky(' refreshSession: success, handle:', session?.handle);
    return true;
  } catch (e) {
    console.error('[bluesky] refreshSession error:', e);
    return false;
  }
}

/**
 * Get profile for a handle (no auth required)
 */
export async function getProfile(handle: string): Promise<BlueskyProfile | null> {
  if (!handle || !handle.trim()) {
    return null;
  }

  try {
    const url = new URL(`${PUBLIC_API}/xrpc/app.bsky.actor.getProfile`);
    url.searchParams.set('actor', handle.trim());

    logBluesky(' getProfile:', handle);
    const res = await fetch(url.toString());
    if (!res.ok) {
      try {
        const errorData = await res.json();
        if (errorData.message === 'Profile not found') {
          logBluesky(' profile not found:', handle);
        } else {
          logBluesky(' getProfile failed:', res.status, errorData.message || errorData.error);
        }
      } catch {
        logBluesky(' getProfile failed:', res.status);
      }
      return null;
    }

    const data = await res.json();
    return {
      did: data.did,
      handle: data.handle,
      displayName: data.displayName,
      avatar: data.avatar,
    };
  } catch (e) {
    console.error('[bluesky] getProfile error:', e);
    return null;
  }
}

/**
 * Get timeline posts (requires auth)
 */
export async function getTimeline(since?: string): Promise<BlueskyPost[]> {
  if (!session) {
    logBluesky(' not logged in, cannot get timeline');
    return [];
  }

  const posts: BlueskyPost[] = [];
  const startTime = Date.now();
  logBluesky(' getTimeline start');

  try {
    const url = new URL(`${BSKY_API}/xrpc/app.bsky.feed.getTimeline`);
    url.searchParams.set('limit', '50');

    let res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${session.accessJwt}`,
      },
    });

    // Try refresh on 400 error (expired token)
    if (res.status === 400) {
      logBluesky(' getTimeline: token expired, refreshing...');
      const refreshed = await refreshSession();
      if (refreshed && session) {
        res = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${session.accessJwt}`,
          },
        });
      }
    }

    if (!res.ok) {
      logBluesky(` getTimeline failed: ${res.status}, ${Date.now() - startTime}ms`);
      return [];
    }

    logBluesky(` getTimeline fetch done: ${Date.now() - startTime}ms`);
    const data = await res.json();
    for (const item of data.feed || []) {
      const post = item.post;
      if (!post?.record?.text) continue;

      // Skip replies and reposts
      if (item.reply || item.reason) continue;

      // Skip if older than since
      if (since && post.record.createdAt <= since) continue;

      posts.push({
        uri: post.uri,
        cid: post.cid,
        author: {
          did: post.author.did,
          handle: post.author.handle,
          displayName: post.author.displayName,
          avatar: post.author.avatar,
        },
        text: post.record.text,
        createdAt: post.record.createdAt,
      });
    }

    logBluesky(` getTimeline done: ${posts.length} posts in ${Date.now() - startTime}ms`);
    return posts;
  } catch (e) {
    console.error('[bluesky] getTimeline error:', e);
    return [];
  }
}

/**
 * Peek latest post to check for new posts (requires auth)
 * Returns the createdAt of the latest post, or null if no new posts
 */
export async function peekLatest(since?: string): Promise<string | null> {
  if (!session) {
    return null;
  }

  const startTime = Date.now();

  try {
    const url = new URL(`${BSKY_API}/xrpc/app.bsky.feed.getTimeline`);
    url.searchParams.set('limit', '1');

    let res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${session.accessJwt}`,
      },
    });

    // Try refresh on 400 error (expired token)
    if (res.status === 400) {
      logBluesky(' peekLatest: token expired, refreshing...');
      const refreshed = await refreshSession();
      if (refreshed && session) {
        res = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${session.accessJwt}`,
          },
        });
      }
    }

    if (!res.ok) {
      logBluesky(` peekLatest failed: ${res.status}, ${Date.now() - startTime}ms`);
      return null;
    }

    const data = await res.json();
    const item = data.feed?.[0];
    if (!item?.post?.record?.createdAt) {
      logBluesky(` peekLatest: no posts, ${Date.now() - startTime}ms`);
      return null;
    }

    const createdAt = item.post.record.createdAt;
    // Return createdAt only if newer than since
    if (since && createdAt <= since) {
      logBluesky(` peekLatest: no new posts, ${Date.now() - startTime}ms`);
      return null;
    }

    logBluesky(` peekLatest: new post found, ${Date.now() - startTime}ms`);
    return createdAt;
  } catch (e) {
    logBluesky(` peekLatest error: ${e}`);
    return null;
  }
}

/**
 * Create a post (requires auth)
 */
export async function createPost(text: string): Promise<boolean> {
  if (!session) {
    logBluesky(' not logged in');
    return false;
  }

  const makeRequest = () => fetch(`${BSKY_API}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session!.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session!.did,
      collection: 'app.bsky.feed.post',
      record: {
        text,
        createdAt: new Date().toISOString(),
      },
    }),
  });

  try {
    let res = await makeRequest();

    // Try refresh on 400 error (expired token)
    if (res.status === 400) {
      logBluesky(' createPost: token expired, refreshing...');
      const refreshed = await refreshSession();
      if (refreshed && session) {
        res = await makeRequest();
      }
    }

    if (!res.ok) {
      logBluesky(' createPost failed:', res.status);
      return false;
    }

    logBluesky(' post created');
    return true;
  } catch (e) {
    console.error('[bluesky] createPost error:', e);
    return false;
  }
}

/**
 * Like a post (requires auth)
 */
export async function likePost(uri: string, cid: string): Promise<boolean> {
  if (!session) {
    logBluesky(' not logged in');
    return false;
  }

  const makeRequest = () => fetch(`${BSKY_API}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session!.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session!.did,
      collection: 'app.bsky.feed.like',
      record: {
        subject: { uri, cid },
        createdAt: new Date().toISOString(),
      },
    }),
  });

  try {
    let res = await makeRequest();

    // Try refresh on 400 error (expired token)
    if (res.status === 400) {
      logBluesky(' likePost: token expired, refreshing...');
      const refreshed = await refreshSession();
      if (refreshed && session) {
        res = await makeRequest();
      }
    }

    if (!res.ok) {
      logBluesky(' likePost failed:', res.status);
      return false;
    }

    logBluesky(' post liked');
    return true;
  } catch (e) {
    console.error('[bluesky] likePost error:', e);
    return false;
  }
}
