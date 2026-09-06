# X/Twitter Integration Architecture for yomi

## 1. Architecture Overview

### Design Principle

**Browser-only** - No separate Node.js server. All X/Twitter integration runs inside the existing yomi React SPA, following the same pattern as Bluesky and Misskey.

### Architecture Diagram

```
┌──────────────────────────────────────────────┐
│              yomi (Browser SPA)              │
│                                              │
│  src/twitter/index.ts                        │
│  ├── OAuth 2.0 PKCE (Public Client)          │
│  ├── REST API calls (polling)                │
│  └── Token management (localStorage)         │
│                                              │
│  OAuth redirect ←→ x.com/i/oauth2/authorize  │
│  API calls      ←→ api.x.com/2/*             │
└──────────────────────────────────────────────┘
```

### Architecture Comparison with Existing Sources

| Aspect | Nostr | Bluesky | Misskey | Discord | **X/Twitter** |
|--------|-------|---------|---------|---------|---------------|
| Auth | NIP-07 / pubkey | App password | Access token | Bot token | **OAuth 2.0 PKCE** |
| User input | pubkey | handle + appKey | accessToken | botUrl | **Client ID only** |
| Timeline | WebSocket relay | REST polling | WebSocket stream | WebSocket (via bot) | **REST polling** |
| Posting | Direct from browser | Direct from browser | Direct from browser | N/A | **Direct from browser** |
| Backend needed | No | No | No | Yes (discord-bot) | **No** |
| Token storage | N/A | localStorage | localStorage | N/A | **localStorage** |

### CORS Handling

Same approach as Misskey (`src/misskey/index.ts`):

```typescript
const X_API = import.meta.env.DEV
  ? '/x-api'
  : (import.meta.env.VITE_X_API_PROXY_URL || 'https://api.x.com');
```

- **Development** (`npm run dev`): Vite dev proxy forwards `/x-api` → `https://api.x.com`
- **Production** (GitHub Pages): Cloudflare Worker CORS proxy (configured via `VITE_X_API_PROXY_URL` in `.env.production`)

Vite proxy config (`vite.config.ts`):

```typescript
'/x-api': {
  target: 'https://api.x.com',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/x-api/, ''),
  secure: true,
},
```

## 2. Authentication Flow

### OAuth 2.0 PKCE (Public Client / SPA)

- **App type**: Single Page App (Public Client) in X Developer Portal
- **Client Secret**: Not required
- **User input**: Client ID only
- **Scopes**: `tweet.read tweet.write list.read users.read offline.access`

### Step-by-Step Flow

```
1. User enters Client ID and clicks "Authenticate"
   ↓
2. yomi generates code_verifier + code_challenge (PKCE)
   Merges code_verifier, state, client_id into the localStorage key "yomi:x":
     { codeVerifier: <random>, oauthState: <random>, clientId: <client id> }
   ↓
3. window.location.href = "https://x.com/i/oauth2/authorize?..."
   (full page redirect, no CORS issue)
   ↓
4. User authorizes on X
   ↓
5. X redirects back to yomi with query params:
   https://koteitan.github.io/yomi/?code=xxx&state=yyy
   ↓
6. yomi detects ?code= and ?state= in URL on page load
   Checks: state === (JSON in "yomi:x").oauthState
   If match → this is an X/Twitter callback
   ↓
7. yomi POSTs to api.x.com/2/oauth2/token:
   { grant_type: "authorization_code", code, client_id, code_verifier, redirect_uri }
   ↓
8. Receives { access_token, refresh_token, expires_in }
   Merges into the localStorage key "yomi:x":
     accessToken    = <token>
     refreshToken   = <token>
     tokenExpiresAt = Date.now() + expires_in * 1000
   Cleans up: drops codeVerifier, oauthState from that object
   ↓
9. Removes ?code= and ?state= from URL (history.replaceState)
   UI updates to authenticated state
```

### Callback URL

Register the following URLs as **Redirect URIs** in X Developer Portal
(Developer Portal → App → Settings → User authentication settings → Callback URI / Redirect URL):

```
https://koteitan.github.io/yomi/
https://localhost:5173/yomi/
```

- The first URL is for production (GitHub Pages).
- The second URL is for local development (`npm run dev`).
- X will redirect to this URL with `?code=xxx&state=yyy` appended after the user authorizes.
- The registered URL must **exactly match** the `redirect_uri` parameter in the OAuth request.

### Token Storage (localStorage)

Every koteitan GitHub Pages app shares the `https://koteitan.github.io` origin,
so all keys are namespaced with the repository name (`yomi:`). X/Twitter uses two
keys, each holding a single JSON object.

`yomi:x` — auth state:

| Field | Value | Lifetime |
|-------|-------|----------|
| `accessToken` | OAuth2 access token | ~2 hours |
| `refreshToken` | OAuth2 refresh token | Long-lived |
| `tokenExpiresAt` | Expiry timestamp (ms) | Updated on refresh |
| `clientId` | OAuth2 Client ID | Persistent |
| `codeVerifier` | PKCE code verifier | Temporary (during auth) |
| `oauthState` | CSRF state | Temporary (during auth) |

`yomi:x-cache` — cached API results (kept apart from the auth state):

| Field | Value | Lifetime |
|-------|-------|----------|
| `ownedLists` | Cached owned lists | Persistent (cache) |
| `myProfile` | Cached user profile | Persistent (cache) |

Migration: when `yomi:x` / `yomi:x-cache` are absent, the old unprefixed keys
(`x_access_token`, `x_refresh_token`, `x_token_expires_at`, `x_client_id`,
`x_code_verifier`, `x_oauth_state`, `x_owned_lists`, `x_my_profile`) are read as
a fallback. Writes always go to the new keys, and the old keys are never deleted.
Logout stores empty objects in the new keys rather than removing them, so a
leftover legacy key is not read back as a session.

### Token Refresh

```
On API call → check if token expires soon (< 5 min)
  ↓ yes
POST api.x.com/2/oauth2/token:
  { grant_type: "refresh_token", refresh_token, client_id }
  ↓
Save new access_token + refresh_token into "yomi:x"
```

## 3. Data Flow: Timeline Reading

### Polling (same pattern as Bluesky)

X API does not support streaming for list timelines. yomi polls at regular intervals.

```
handleStart()
  ↓
initTwitter()
  ↓
Fetch initial tweet (1 latest)
  ↓
Start setInterval (every 30 seconds)
  ↓
Each poll: GET /2/lists/:id/tweets?max_results=1
  ↓
If new tweet found → addTwitterPosts() → NoteWithRead → TTS queue
```

### List Timeline

```
GET /2/lists/:id/tweets
  ?max_results=1
  &tweet.fields=created_at,text,author_id
  &expansions=author_id
  &user.fields=name,username,profile_image_url
```

### Home Timeline

```
GET /2/users/:id/timelines/reverse_chronological
  ?max_results=1
  &tweet.fields=created_at,text,author_id
  &expansions=author_id
  &user.fields=name,username,profile_image_url
```

### Deduplication

- Track `lastSeenTweetId` in module state
- Only process tweets with newer IDs
- X API's 24-hour dedup means repeated polls for same tweets don't incur extra cost

## 4. Data Flow: Posting

Direct from browser (same as Bluesky/Misskey):

```
handlePost()
  ↓
POST /2/tweets
  Authorization: Bearer {access_token}
  Body: { "text": "Hello from yomi" }
```

## 5. API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `x.com/i/oauth2/authorize` | GET (redirect) | OAuth authorization page |
| `api.x.com/2/oauth2/token` | POST | Token exchange / refresh |
| `api.x.com/2/users/me` | GET | Get authenticated user info |
| `api.x.com/2/users/:id/owned_lists` | GET | Get user's lists for dropdown |
| `api.x.com/2/lists/:id/tweets` | GET | Get list timeline |
| `api.x.com/2/users/:id/timelines/reverse_chronological` | GET | Get home timeline |
| `api.x.com/2/tweets` | POST | Create a tweet |

## 6. File List

### New Files

```
src/twitter/index.ts    # X API module (OAuth, API calls, token management)
```

### Modified Files

```
src/App.tsx             # NoteSource 'twitter', initTwitter, addTwitterPosts, Config UI, Post destinations
src/config/index.ts     # X/Twitter config fields
src/i18n.ts             # X/Twitter translation keys (18 languages)
src/utils/logger.ts     # logTwitter, logTwitterEvent
src/version.ts          # Version bump
vite.config.ts          # X API dev proxy
```

## 7. Config Fields

### New Fields in `Config` interface (`src/config/index.ts`)

```typescript
sourceTwitter: boolean;              // Enable X/Twitter source (default: false)
twitterClientId: string;             // OAuth 2.0 Client ID (default: '')
twitterTimelineType: 'list' | 'home'; // Timeline type (default: 'list')
twitterListId: string;               // Selected list ID (default: '')
```

### NoteSource Extension

```typescript
type NoteSource = 'nostr' | 'bluesky' | 'misskey' | 'discord' | 'twitter' | 'test';
```

## 8. `src/twitter/index.ts` Functions

```typescript
// PKCE helpers
generateCodeVerifier(): string
generateCodeChallenge(verifier: string): Promise<string>

// OAuth
startAuth(clientId: string): Promise<void>               // Redirect to X (redirectUri auto-generated)
handleCallback(): Promise<boolean>                       // Process callback params
refreshAccessToken(): Promise<boolean>                   // Refresh expired token
logout(): void                                           // Clear tokens

// State
isLoggedIn(): boolean
getAccessToken(): Promise<string | null>                 // Auto-refreshes if expiring soon

// Cache
getCachedOwnedLists(): TwitterList[] | null              // Get cached lists from localStorage
getCachedProfile(): TwitterUser | null                   // Get cached profile from localStorage

// API
getMyUser(): Promise<TwitterUser | null>
getOwnedLists(): Promise<TwitterList[]>
getListTweets(listId: string, sinceId?: string): Promise<TwitterTweet[]>
getHomeTimeline(sinceId?: string): Promise<TwitterTweet[]>
createTweet(text: string): Promise<boolean>
```

## 9. Config UI

### Before Authentication

```
[✓] X/Twitter
    Client ID: [________________] [Authenticate]
    Timeline Type:
      (●) List
          List: [  (disabled)  ▼]
      ( ) Following Timeline
```

### After Authentication

```
[✓] X/Twitter
    Client ID: [abc123...      ] [Logout]
    Timeline Type:
      (●) List
          List: [My Tech List  ▼]
                ├ My Tech List
                ├ News
                └ Friends
      ( ) Following Timeline
```

### Post Destinations

```
Post destinations:
  [✓] Nostr  [✓] Bluesky  [✓] Misskey.io  [✓] X/Twitter
```

X/Twitter checkbox is disabled when not authenticated.

## 10. i18n Keys

New translation keys for all 18 languages:

| Key | English |
|-----|---------|
| `sourceTwitter` | `X/Twitter` |
| `twitterClientIdPlaceholder` | `OAuth 2.0 Client ID` |
| `twitterAuthenticate` | `Authenticate` |
| `twitterLogout` | `Logout` |
| `twitterTimelineType` | `Timeline Type` |
| `twitterTimelineList` | `List` |
| `twitterTimelineHome` | `Following Timeline` |
| `twitterList` | `List` |
| `twitterAddress` | `X/Twitter` |

## 11. Rate Limits

### Per-Endpoint Limits

Rate limits for X API v2 endpoints used by yomi (per 15-minute window, user context):

| Endpoint | Rate Limit (per 15 min) | Notes |
|----------|------------------------|-------|
| POST /2/oauth2/token | Not documented | Known to be rate-limited |
| GET /2/users/me | 75 | User context |
| GET /2/users/:id/owned_lists | 15 | Cached in localStorage to reduce calls |
| GET /2/lists/:id/tweets | 900 | |
| GET /2/users/:id/timelines/reverse_chronological | 180 | |
| POST /2/tweets | 100 per 24h | Free: 1,500/month |

### yomi Polling Consumption

- **Timeline**: 30-second interval → 30 requests per 15 min (well within 180 or 900 limit)
- **owned_lists**: 1 request on page load (cached, well within 15 limit)

## 12. Error Handling

| Scenario | Handling |
|----------|----------|
| Token expired | Auto-refresh using refresh_token |
| Refresh token expired | Show "Authenticate" button again, clear tokens |
| CORS blocked (production) | Log error, show message to user |
| API rate limit (429) | Logged, returns null/empty (no backoff implemented yet) |
| Network error during poll | Retry on next poll interval |
| Post fails | Log error, return false |
| Invalid Client ID | OAuth page shows error, user returns to yomi |

## 13. Security Considerations

1. **No Client Secret** - Public Client type, only Client ID needed (safe to store in localStorage)
2. **PKCE** - Prevents authorization code interception attacks
3. **State parameter** - CSRF protection during OAuth flow
4. **Tokens in localStorage** - Same security level as Bluesky/Misskey tokens in yomi
5. **Token refresh** - Access tokens are short-lived (~2 hours), auto-refreshed
