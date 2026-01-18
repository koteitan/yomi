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
 */
export async function login(handle: string, appPassword: string, force = false): Promise<boolean> {
  // Use existing session if not forced
  if (!force && session && session.handle === handle) {
    logBluesky(' using existing session for:', handle);
    return true;
  }

  try {
    const res = await fetch(`${BSKY_API}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: handle, password: appPassword }),
    });
    if (!res.ok) {
      logBluesky(' login failed:', res.status);
      return false;
    }
    session = await res.json();
    // Save session to localStorage
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    logBluesky(' logged in as:', session?.handle);
    return true;
  } catch (e) {
    console.error('[bluesky] login error:', e);
    return false;
  }
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
 * Get follows list for a handle (no auth required)
 */
export async function getFollows(handle: string): Promise<BlueskyProfile[]> {
  const follows: BlueskyProfile[] = [];
  let cursor: string | undefined;
  let pageNum = 0;
  const startTime = Date.now();
  logBluesky(' getFollows start');

  try {
    do {
      pageNum++;
      const url = new URL(`${PUBLIC_API}/xrpc/app.bsky.graph.getFollows`);
      url.searchParams.set('actor', handle);
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);

      const res = await fetch(url.toString());
      if (!res.ok) {
        try {
          const errorData = await res.json();
          if (errorData.message === 'Profile not found') {
            logBluesky(' profile not found:', handle);
          } else {
            logBluesky(' getFollows failed:', res.status, errorData.message || errorData.error);
          }
        } catch {
          logBluesky(' getFollows failed:', res.status);
        }
        break;
      }

      const data = await res.json();
      for (const f of data.follows || []) {
        follows.push({
          did: f.did,
          handle: f.handle,
          displayName: f.displayName,
          avatar: f.avatar,
        });
      }
      cursor = data.cursor;
      logBluesky(` getFollows page ${pageNum}: ${follows.length} follows, ${Date.now() - startTime}ms`);
    } while (cursor);

    logBluesky(` getFollows done: ${follows.length} follows in ${Date.now() - startTime}ms`);
    return follows;
  } catch (e) {
    console.error('[bluesky] getFollows error:', e);
    return [];
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
 * Get posts from followed accounts (no auth required, but slower)
 */
export async function getFollowsPosts(
  follows: BlueskyProfile[],
  since?: string
): Promise<BlueskyPost[]> {
  const posts: BlueskyPost[] = [];
  const startTime = Date.now();
  logBluesky(` getFollowsPosts start: ${follows.length} users`);

  try {
    // Get 1 latest post from each followed account
    const dids = follows.map((f) => f.did);

    for (let i = 0; i < dids.length; i++) {
      const did = dids[i];
      if (i % 10 === 0) {
        logBluesky(` getFollowsPosts progress: ${i}/${dids.length}, ${Date.now() - startTime}ms`);
      }
      const url = new URL(`${PUBLIC_API}/xrpc/app.bsky.feed.getAuthorFeed`);
      url.searchParams.set('actor', did);
      url.searchParams.set('limit', '5');

      const res = await fetch(url.toString());
      if (!res.ok) continue;

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
        break; // Only take the first valid post per user
      }
    }

    // Sort by createdAt descending
    posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    logBluesky(` getFollowsPosts done: ${posts.length} posts in ${Date.now() - startTime}ms`);
    return posts;
  } catch (e) {
    console.error('[bluesky] getFollowsPosts error:', e);
    return [];
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

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${session.accessJwt}`,
      },
    });

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

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${session.accessJwt}`,
      },
    });

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

  try {
    const res = await fetch(`${BSKY_API}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record: {
          text,
          createdAt: new Date().toISOString(),
        },
      }),
    });

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

  try {
    const res = await fetch(`${BSKY_API}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.like',
        record: {
          subject: { uri, cid },
          createdAt: new Date().toISOString(),
        },
      }),
    });

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
