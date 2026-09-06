/**
 * localStorage helpers namespaced for this app.
 *
 * All GitHub Pages sites under https://koteitan.github.io/ share a single
 * origin, so every key must be prefixed with the repository name to avoid
 * collisions with the other apps hosted there.
 *
 *   new key = "yomi:" + name
 *
 * Migration policy:
 *   - Reads fall back to the old unprefixed key when the new key is absent.
 *   - Writes always go to the new key.
 *   - Old keys are never deleted.
 */

const NS = 'yomi';

/** Build the namespaced key for `name`. */
export function lsKey(name: string): string {
  return `${NS}:${name}`;
}

/** True when the namespaced key exists (even if its value is empty or null). */
export function hasKey(name: string): boolean {
  try {
    return localStorage.getItem(lsKey(name)) !== null;
  } catch {
    return false;
  }
}

/**
 * Read a raw string from the namespaced key.
 * Falls back to `legacyKey` (unprefixed) when the namespaced key is absent.
 */
export function loadString(name: string, legacyKey?: string): string | null {
  try {
    const raw = localStorage.getItem(lsKey(name));
    if (raw !== null) return raw;
    if (legacyKey) return localStorage.getItem(legacyKey);
  } catch {
    // Ignore errors (storage disabled, quota, etc.)
  }
  return null;
}

/** Write a raw string to the namespaced key. */
export function saveString(name: string, value: string): void {
  try {
    localStorage.setItem(lsKey(name), value);
  } catch (e) {
    console.error(`Failed to save ${lsKey(name)}:`, e);
  }
}

/**
 * Read and JSON.parse the namespaced key.
 * Falls back to `legacyKey` (unprefixed) when the namespaced key is absent.
 * Returns null when nothing is stored or the value cannot be parsed.
 */
export function loadJson<T>(name: string, legacyKey?: string): T | null {
  try {
    const raw = localStorage.getItem(lsKey(name));
    if (raw !== null) return JSON.parse(raw) as T;
    if (legacyKey) {
      const old = localStorage.getItem(legacyKey);
      if (old !== null) return JSON.parse(old) as T;
    }
  } catch {
    // Ignore errors (storage disabled, malformed JSON, etc.)
  }
  return null;
}

/** JSON.stringify `value` into the namespaced key. */
export function saveJson(name: string, value: unknown): void {
  try {
    localStorage.setItem(lsKey(name), JSON.stringify(value));
  } catch (e) {
    console.error(`Failed to save ${lsKey(name)}:`, e);
  }
}

/** Read a raw string from an old, unprefixed key (migration reads only). */
export function loadLegacyString(legacyKey: string): string | null {
  try {
    return localStorage.getItem(legacyKey);
  } catch {
    return null;
  }
}

/** Read and JSON.parse an old, unprefixed key (migration reads only). */
export function loadLegacyJson<T>(legacyKey: string): T | null {
  try {
    const raw = localStorage.getItem(legacyKey);
    if (raw !== null) return JSON.parse(raw) as T;
  } catch {
    // Ignore errors (malformed JSON, etc.)
  }
  return null;
}
