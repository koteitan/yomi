import { logTwitter } from '../utils';
import { loadJson, saveJson, loadLegacyString, loadLegacyJson } from '../utils/storage';

// Use Vite proxy in dev, CORS proxy worker in production (configurable via VITE_X_API_PROXY_URL)
const X_API = import.meta.env.DEV
  ? '/x-api'
  : (import.meta.env.VITE_X_API_PROXY_URL || 'https://api.x.com');

// ============================================
// Interfaces
// ============================================

export interface TwitterUser {
  id: string;
  username: string;
  name: string;
  profileImageUrl: string | null;
}

export interface TwitterList {
  id: string;
  name: string;
  memberCount: number;
  isPrivate: boolean;
}

export interface TwitterTweet {
  id: string;
  text: string;
  authorId: string;
  author: TwitterUser;
  createdAt: string; // ISO 8601
}

// ============================================
// Module State
// ============================================

let accessToken: string | null = null;
let refreshToken: string | null = null;
let tokenExpiresAt: number | null = null;
let clientId: string | null = null;
let myUserId: string | null = null;

// ============================================
// localStorage
// ============================================
// Auth values are kept together in "yomi:x", cached API results in
// "yomi:x-cache". The old unprefixed keys below are read only as a migration
// fallback and are never written or deleted.

const AUTH_NAME = 'x';
const CACHE_NAME = 'x-cache';

const LEGACY_KEY_ACCESS_TOKEN = 'x_access_token';
const LEGACY_KEY_REFRESH_TOKEN = 'x_refresh_token';
const LEGACY_KEY_TOKEN_EXPIRES_AT = 'x_token_expires_at';
const LEGACY_KEY_CODE_VERIFIER = 'x_code_verifier';
const LEGACY_KEY_OAUTH_STATE = 'x_oauth_state';
const LEGACY_KEY_CLIENT_ID = 'x_client_id';
const LEGACY_KEY_OWNED_LISTS = 'x_owned_lists';
const LEGACY_KEY_MY_PROFILE = 'x_my_profile';

interface XAuthState {
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: number | null;
  codeVerifier?: string | null;
  oauthState?: string | null;
  clientId?: string | null;
}

interface XCacheState {
  ownedLists?: TwitterList[] | null;
  myProfile?: TwitterUser | null;
}

/** Read the auth object; assemble it from the legacy keys when the new key is absent. */
function loadAuth(): XAuthState {
  const stored = loadJson<XAuthState>(AUTH_NAME);
  if (stored) return stored;
  const legacyExpires = loadLegacyString(LEGACY_KEY_TOKEN_EXPIRES_AT);
  return {
    accessToken: loadLegacyString(LEGACY_KEY_ACCESS_TOKEN),
    refreshToken: loadLegacyString(LEGACY_KEY_REFRESH_TOKEN),
    tokenExpiresAt: legacyExpires ? Number(legacyExpires) : null,
    codeVerifier: loadLegacyString(LEGACY_KEY_CODE_VERIFIER),
    oauthState: loadLegacyString(LEGACY_KEY_OAUTH_STATE),
    clientId: loadLegacyString(LEGACY_KEY_CLIENT_ID),
  };
}

/** Merge `patch` into the stored auth object; fields set to null are dropped. */
function patchAuth(patch: XAuthState): void {
  const next: XAuthState = { ...loadAuth(), ...patch };
  for (const k of Object.keys(next) as (keyof XAuthState)[]) {
    if (next[k] === null || next[k] === undefined) delete next[k];
  }
  saveJson(AUTH_NAME, next);
}

/** Read the cache object; assemble it from the legacy keys when the new key is absent. */
function loadCache(): XCacheState {
  const stored = loadJson<XCacheState>(CACHE_NAME);
  if (stored) return stored;
  return {
    ownedLists: loadLegacyJson<TwitterList[]>(LEGACY_KEY_OWNED_LISTS),
    myProfile: loadLegacyJson<TwitterUser>(LEGACY_KEY_MY_PROFILE),
  };
}

/** Merge `patch` into the stored cache object. */
function patchCache(patch: XCacheState): void {
  saveJson(CACHE_NAME, { ...loadCache(), ...patch });
}

// ============================================
// Restore tokens from localStorage on load
// ============================================

const restoredAuth = loadAuth();
if (restoredAuth.accessToken) {
  accessToken = restoredAuth.accessToken;
  refreshToken = restoredAuth.refreshToken ?? null;
  tokenExpiresAt = restoredAuth.tokenExpiresAt ?? null;
  clientId = restoredAuth.clientId ?? null;
  logTwitter(' token restored');
}

// ============================================
// PKCE Helpers (internal)
// ============================================

/**
 * Generate a random code verifier for PKCE
 * Uses crypto.getRandomValues and base64url encoding
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Generate a code challenge from a code verifier using SHA-256
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Base64url encode a Uint8Array (no padding)
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ============================================
// OAuth Functions
// ============================================

/**
 * Start the OAuth 2.0 PKCE authentication flow.
 * Generates PKCE values, saves them to localStorage, and redirects to X authorization page.
 */
export async function startAuth(clientId: string): Promise<void> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateCodeVerifier(); // reuse as random state

  // Save temporary values and client ID
  patchAuth({ codeVerifier, oauthState: state, clientId });

  const redirectUri = window.location.origin + '/yomi/';

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'tweet.read tweet.write list.read users.read offline.access',
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  logTwitter(' startAuth: redirecting to X authorization page');
  window.location.href = `https://x.com/i/oauth2/authorize?${params.toString()}`;
}

/**
 * Handle the OAuth callback after X redirects back.
 * Checks for ?code= and ?state= in URL, exchanges code for tokens.
 * Returns true if a callback was successfully processed.
 */
let handleCallbackInProgress = false;
export async function handleCallback(): Promise<boolean> {
  if (handleCallbackInProgress) {
    return false;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state = urlParams.get('state');

  if (!code || !state) {
    return false;
  }

  handleCallbackInProgress = true;

  // Verify state matches
  const savedAuth = loadAuth();
  const savedState = savedAuth.oauthState ?? null;
  if (state !== savedState) {
    logTwitter(' handleCallback: state mismatch, ignoring');
    return false;
  }

  const savedVerifier = savedAuth.codeVerifier ?? null;
  const savedClientId = savedAuth.clientId ?? null;

  if (!savedVerifier || !savedClientId) {
    logTwitter(' handleCallback: missing code_verifier or client_id');
    return false;
  }

  const redirectUri = window.location.origin + '/yomi/';

  try {
    logTwitter(' handleCallback: exchanging code for token');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: savedClientId,
      redirect_uri: redirectUri,
      code_verifier: savedVerifier,
    });

    const res = await fetch(`${X_API}/2/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const errorText = await res.text();
      logTwitter(' handleCallback: token exchange failed:', res.status, errorText);
      return false;
    }

    const data = await res.json();

    // Save tokens
    accessToken = data.access_token;
    refreshToken = data.refresh_token || null;
    tokenExpiresAt = Date.now() + data.expires_in * 1000;
    clientId = savedClientId;

    const authPatch: XAuthState = {
      accessToken,
      tokenExpiresAt,
      // Clean up temporary values
      codeVerifier: null,
      oauthState: null,
    };
    if (refreshToken) authPatch.refreshToken = refreshToken;
    patchAuth(authPatch);

    // Remove query params from URL
    const cleanUrl = window.location.origin + window.location.pathname;
    history.replaceState({}, document.title, cleanUrl);

    logTwitter(' handleCallback: authentication successful');
    return true;
  } catch (e) {
    console.error('[twitter] handleCallback error:', e);
    handleCallbackInProgress = false;
    return false;
  }
}

/**
 * Refresh the access token using the refresh token.
 * Returns true on success, false on failure.
 */
export async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken || !clientId) {
    logTwitter(' refreshAccessToken: no refresh token or client ID');
    return false;
  }

  try {
    logTwitter(' refreshAccessToken: refreshing...');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    });

    const res = await fetch(`${X_API}/2/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const errorText = await res.text();
      logTwitter(' refreshAccessToken: failed:', res.status, errorText);
      // Clear invalid tokens
      logout();
      return false;
    }

    const data = await res.json();

    accessToken = data.access_token;
    refreshToken = data.refresh_token || refreshToken;
    tokenExpiresAt = Date.now() + data.expires_in * 1000;

    const authPatch: XAuthState = { accessToken, tokenExpiresAt };
    if (refreshToken) authPatch.refreshToken = refreshToken;
    patchAuth(authPatch);

    logTwitter(' refreshAccessToken: success');
    return true;
  } catch (e) {
    console.error('[twitter] refreshAccessToken error:', e);
    return false;
  }
}

/**
 * Logout: clear the X/Twitter localStorage entries and the module state
 */
export function logout(): void {
  accessToken = null;
  refreshToken = null;
  tokenExpiresAt = null;
  clientId = null;
  myUserId = null;

  // Store empty objects instead of removing them, so that leftover legacy keys
  // are not read back as a session on the next load
  saveJson(AUTH_NAME, {});
  saveJson(CACHE_NAME, {});

  logTwitter(' logged out');
}

/**
 * Get cached owned lists from localStorage.
 */
export function getCachedOwnedLists(): TwitterList[] | null {
  return loadCache().ownedLists ?? null;
}

/**
 * Get cached profile from localStorage.
 */
export function getCachedProfile(): TwitterUser | null {
  return loadCache().myProfile ?? null;
}

/**
 * Check if the user is logged in (has an access token)
 */
export function isLoggedIn(): boolean {
  return accessToken !== null;
}

/**
 * Get the current access token, auto-refreshing if it expires within 5 minutes.
 * Returns null if not logged in or refresh fails.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!accessToken) {
    return null;
  }

  // Check if token expires within 5 minutes (300000ms)
  if (tokenExpiresAt && Date.now() > tokenExpiresAt - 300000) {
    logTwitter(' getAccessToken: token expiring soon, refreshing...');
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      return null;
    }
  }

  return accessToken;
}

// ============================================
// Authorized API Helper
// ============================================

/**
 * Make an authorized API request with auto token refresh.
 * Returns the Response object or null on failure.
 */
async function authorizedFetch(url: string, options: RequestInit = {}): Promise<Response | null> {
  const token = await getAccessToken();
  if (!token) {
    logTwitter(' authorizedFetch: not logged in');
    return null;
  }

  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);

  try {
    const res = await fetch(url, { ...options, headers });

    // If unauthorized, try refreshing token once
    if (res.status === 401) {
      logTwitter(' authorizedFetch: 401, attempting token refresh');
      const refreshed = await refreshAccessToken();
      if (refreshed && accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`);
        return await fetch(url, { ...options, headers });
      }
      return null;
    }

    return res;
  } catch (e) {
    console.error('[twitter] authorizedFetch error:', e);
    return null;
  }
}

// ============================================
// API Functions
// ============================================

/**
 * Get the authenticated user's profile.
 * Caches the userId in module state for subsequent API calls.
 */
export async function getMyUser(): Promise<TwitterUser | null> {
  const startTime = Date.now();
  logTwitter(' getMyUser start');

  const res = await authorizedFetch(
    `${X_API}/2/users/me?user.fields=name,username,profile_image_url`
  );

  if (!res || !res.ok) {
    logTwitter(` getMyUser failed: ${res?.status}, ${Date.now() - startTime}ms`);
    return null;
  }

  try {
    const data = await res.json();
    const user = data.data;
    if (!user) {
      logTwitter(` getMyUser: no user data, ${Date.now() - startTime}ms`);
      return null;
    }

    // Cache userId for subsequent calls
    myUserId = user.id;

    const result: TwitterUser = {
      id: user.id,
      username: user.username,
      name: user.name,
      profileImageUrl: user.profile_image_url || null,
    };

    logTwitter(` getMyUser done: @${result.username}, ${Date.now() - startTime}ms`);
    patchCache({ myProfile: result });
    return result;
  } catch (e) {
    console.error('[twitter] getMyUser error:', e);
    return null;
  }
}

/**
 * Get the authenticated user's owned lists.
 * Requires the user ID (fetches via getMyUser if not cached).
 */
export async function getOwnedLists(): Promise<TwitterList[]> {
  const startTime = Date.now();
  logTwitter(' getOwnedLists start');

  // Ensure we have the user ID
  if (!myUserId) {
    const user = await getMyUser();
    if (!user) {
      logTwitter(' getOwnedLists: could not get user ID');
      return [];
    }
  }

  const res = await authorizedFetch(
    `${X_API}/2/users/${myUserId}/owned_lists?list.fields=member_count,private`
  );

  if (!res || !res.ok) {
    logTwitter(` getOwnedLists failed: ${res?.status}, ${Date.now() - startTime}ms`);
    return [];
  }

  try {
    const data = await res.json();
    const lists = data.data || [];

    const result: TwitterList[] = lists.map((list: Record<string, unknown>) => ({
      id: list.id as string,
      name: list.name as string,
      memberCount: (list.member_count as number) || 0,
      isPrivate: (list.private as boolean) || false,
    }));

    logTwitter(` getOwnedLists done: ${result.length} lists, ${Date.now() - startTime}ms`);
    patchCache({ ownedLists: result });
    return result;
  } catch (e) {
    console.error('[twitter] getOwnedLists error:', e);
    return [];
  }
}

/**
 * Parse tweets from X API v2 response with user expansions.
 */
function parseTweetsResponse(data: Record<string, unknown>): TwitterTweet[] {
  const tweets = (data.data as Record<string, unknown>[]) || [];
  const includes = data.includes as Record<string, unknown[]> | undefined;
  const users = (includes?.users || []) as Record<string, unknown>[];

  // Build user lookup map
  const userMap = new Map<string, TwitterUser>();
  for (const u of users) {
    userMap.set(u.id as string, {
      id: u.id as string,
      username: u.username as string,
      name: u.name as string,
      profileImageUrl: (u.profile_image_url as string) || null,
    });
  }

  return tweets.map((tweet) => {
    const authorId = tweet.author_id as string;
    const author = userMap.get(authorId) || {
      id: authorId,
      username: 'unknown',
      name: 'Unknown',
      profileImageUrl: null,
    };

    return {
      id: tweet.id as string,
      text: tweet.text as string,
      authorId,
      author,
      createdAt: tweet.created_at as string,
    };
  });
}

/**
 * Get tweets from a list.
 * @param listId - The list ID to fetch tweets from
 * @param sinceId - Only return tweets newer than this ID
 */
export async function getListTweets(listId: string, sinceId?: string): Promise<TwitterTweet[]> {
  const startTime = Date.now();
  logTwitter(' getListTweets start');

  const params = new URLSearchParams({
    max_results: sinceId ? '10' : '1',
    'tweet.fields': 'created_at,text,author_id',
    expansions: 'author_id',
    'user.fields': 'name,username,profile_image_url',
  });
  if (sinceId) {
    params.set('since_id', sinceId);
  }

  const res = await authorizedFetch(
    `${X_API}/2/lists/${listId}/tweets?${params.toString()}`
  );

  if (!res || !res.ok) {
    logTwitter(` getListTweets failed: ${res?.status}, ${Date.now() - startTime}ms`);
    return [];
  }

  try {
    const data = await res.json();
    const tweets = parseTweetsResponse(data);
    logTwitter(` getListTweets done: ${tweets.length} tweets, ${Date.now() - startTime}ms`);
    return tweets;
  } catch (e) {
    console.error('[twitter] getListTweets error:', e);
    return [];
  }
}

/**
 * Get the authenticated user's following timeline (reverse chronological).
 * @param sinceId - Only return tweets newer than this ID
 */
export async function getHomeTimeline(sinceId?: string): Promise<TwitterTweet[]> {
  const startTime = Date.now();
  logTwitter(' getHomeTimeline start');

  // Ensure we have the user ID
  if (!myUserId) {
    const user = await getMyUser();
    if (!user) {
      logTwitter(' getHomeTimeline: could not get user ID');
      return [];
    }
  }

  const params = new URLSearchParams({
    max_results: sinceId ? '10' : '1',
    'tweet.fields': 'created_at,text,author_id',
    expansions: 'author_id',
    'user.fields': 'name,username,profile_image_url',
  });
  if (sinceId) {
    params.set('since_id', sinceId);
  }

  const res = await authorizedFetch(
    `${X_API}/2/users/${myUserId}/timelines/reverse_chronological?${params.toString()}`
  );

  if (!res || !res.ok) {
    logTwitter(` getHomeTimeline failed: ${res?.status}, ${Date.now() - startTime}ms`);
    return [];
  }

  try {
    const data = await res.json();
    const tweets = parseTweetsResponse(data);
    logTwitter(` getHomeTimeline done: ${tweets.length} tweets, ${Date.now() - startTime}ms`);
    return tweets;
  } catch (e) {
    console.error('[twitter] getHomeTimeline error:', e);
    return [];
  }
}

/**
 * Create a tweet.
 * @param text - The text content of the tweet
 * @returns true on success, false on failure
 */
export async function createTweet(text: string): Promise<boolean> {
  logTwitter(' createTweet start');

  const res = await authorizedFetch(`${X_API}/2/tweets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!res || !res.ok) {
    logTwitter(' createTweet failed:', res?.status);
    return false;
  }

  logTwitter(' tweet created');
  return true;
}
