import { log } from '../utils';

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

let session: Session | null = null;

/**
 * Login to Bluesky with handle and app password
 */
export async function login(handle: string, appPassword: string): Promise<boolean> {
  try {
    const res = await fetch(`${BSKY_API}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: handle, password: appPassword }),
    });
    if (!res.ok) {
      log('[bluesky] login failed:', res.status);
      return false;
    }
    session = await res.json();
    log('[bluesky] logged in as:', session?.handle);
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

  try {
    do {
      const url = new URL(`${PUBLIC_API}/xrpc/app.bsky.graph.getFollows`);
      url.searchParams.set('actor', handle);
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);

      const res = await fetch(url.toString());
      if (!res.ok) {
        try {
          const errorData = await res.json();
          if (errorData.message === 'Profile not found') {
            log('[bluesky] profile not found:', handle);
          } else {
            log('[bluesky] getFollows failed:', res.status, errorData.message || errorData.error);
          }
        } catch {
          log('[bluesky] getFollows failed:', res.status);
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
    } while (cursor);

    log('[bluesky] got follows:', follows.length);
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

    log('[bluesky] getProfile:', handle);
    const res = await fetch(url.toString());
    if (!res.ok) {
      try {
        const errorData = await res.json();
        if (errorData.message === 'Profile not found') {
          log('[bluesky] profile not found:', handle);
        } else {
          log('[bluesky] getProfile failed:', res.status, errorData.message || errorData.error);
        }
      } catch {
        log('[bluesky] getProfile failed:', res.status);
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
 * Get timeline posts from followed accounts (no auth required using public API)
 */
export async function getFollowsPosts(
  follows: BlueskyProfile[],
  since?: string
): Promise<BlueskyPost[]> {
  const posts: BlueskyPost[] = [];

  try {
    // Get posts from each followed account's feed
    // Using getAuthorFeed for each follow (limited to recent posts)
    const dids = follows.slice(0, 50).map((f) => f.did); // Limit to 50 follows for performance

    for (const did of dids) {
      const url = new URL(`${PUBLIC_API}/xrpc/app.bsky.feed.getAuthorFeed`);
      url.searchParams.set('actor', did);
      url.searchParams.set('limit', '10');

      const res = await fetch(url.toString());
      if (!res.ok) continue;

      const data = await res.json();
      for (const item of data.feed || []) {
        const post = item.post;
        if (!post?.record?.text) continue;

        // Skip if older than since
        if (since && post.record.createdAt <= since) continue;

        // Skip replies and reposts
        if (item.reply || item.reason) continue;

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
    }

    // Sort by createdAt descending
    posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    log('[bluesky] got posts:', posts.length);
    return posts;
  } catch (e) {
    console.error('[bluesky] getFollowsPosts error:', e);
    return [];
  }
}

/**
 * Create a post (requires auth)
 */
export async function createPost(text: string): Promise<boolean> {
  if (!session) {
    log('[bluesky] not logged in');
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
      log('[bluesky] createPost failed:', res.status);
      return false;
    }

    log('[bluesky] post created');
    return true;
  } catch (e) {
    console.error('[bluesky] createPost error:', e);
    return false;
  }
}
