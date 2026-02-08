 New Project: Adding X/Twitter Support via Pay-Per-Use API

## Team Structure

- **Product Manager**:
  - Directs the architect and frontend/backend developers
  - Reviews the specification from the architect and the implementation by frontend/backend developers
  - Asks for feedback from the user (me)
- **Architect**:
  - Designs the overall architecture for X integration in a document
- **Frontend Developer**
- **Backend Developer**

## X API Specifications and Hints

- https://claude.ai/share/0d0f5fa6-d816-4d6e-b55f-f724d3fc6967

## Layout

### Config Dialog

- Nostr
- Bluesky
- Misskey.io
- Discord
- X/Twitter **[new!]**
  - Client ID: `[text box]` `[Authenticate button]`
  - Timeline Type:
    - `(●)` List
      - List: `[dropdown of available lists]`
    - `( )` Home Timeline

### Post Destinations

- `[✓]` Nostr
- `[✓]` Bluesky
- `[✓]` Misskey.io
- `[✓]` X/Twitter **[new!]**

## Behavior

### Authentication Flow for X/Twitter

**Before authentication:**

- The List dropdown is disabled and greyed out.
- After entering the Client ID and clicking the Authenticate button, the user is redirected to the X/Twitter OAuth page.
- Upon successful authentication, the user is redirected back to the Yomi callback page with an access token.
  - The Yomi callback page uses a special OAuth query parameter to identify the service as X/Twitter.
- The Yomi callback page saves the access token securely in localStorage.
- After saving the access token, the browser navigates back to the original Yomi page without OAuth query parameters.
- The post destination checkbox for X/Twitter is disabled.

**After authentication:**

- The List dropdown is enabled and populated with the user's available lists from X/Twitter.
- The user can select a list from the dropdown to set the timeline type to that list.
- If the user selects Home Timeline, the List dropdown is disabled and greyed out again.
- The Authenticate button changes to a "Logout" button, which, when clicked, removes the access token from localStorage and reverts the UI to the pre-authentication state.

### Getting Timeline Data from X/Twitter

After authentication, when fetching timeline data:

- If Timeline Type is List, use the saved access token to call the X/Twitter API to get tweets from the selected list.
- If Timeline Type is Home Timeline, use the saved access token to call the X/Twitter API to get tweets from the user's home timeline.
- The number of fetched tweets is limited to the latest 1 tweet.

### Posting to X/Twitter

When the post destination checkbox for X/Twitter is checked:

- When the Post button is clicked, the message is posted to X/Twitter using the saved access token.
