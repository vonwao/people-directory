// You may edit this file, add new files to support this file,
// and/or add new dependencies to the project as you see fit.
// However, you must not change the surface API presented from this file,
// and you should not need to change any other files in the project to complete the challenge

import { useCallback, useEffect, useSyncExternalStore } from 'react';

type UseCachingFetch = (url: string) => {
  isLoading: boolean;
  data: unknown;
  error: Error | null;
};

// one cache for everything, keyed by url.
// entries go loading -> success or error. they get replaced, never mutated,
// so an entry can be used directly as the useSyncExternalStore snapshot
type CacheEntry =
  | { status: 'loading'; promise: Promise<void> }
  | { status: 'success'; data: unknown }
  | { status: 'error'; error: Error };

// what gets sent to the browser. errors only keep their message
type SerializedEntry = { data: unknown } | { error: string };

const cache = new Map<string, CacheEntry>();
const listeners = new Map<string, Set<() => void>>();

const notify = (url: string) => {
  listeners.get(url)?.forEach((listener) => listener());
};

const setEntry = (url: string, entry: CacheEntry) => {
  cache.set(url, entry);
  notify(url);
};

const subscribe = (url: string, listener: () => void) => {
  let urlListeners = listeners.get(url);
  if (!urlListeners) {
    urlListeners = new Set();
    listeners.set(url, urlListeners);
  }
  urlListeners.add(listener);
  return () => {
    urlListeners.delete(listener);
    if (urlListeners.size === 0) listeners.delete(url);
  };
};

const toError = (value: unknown) =>
  value instanceof Error ? value : new Error(String(value));

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Request to ${url} failed with status ${response.status} ${response.statusText}`.trim(),
    );
  }
  return response.json();
};

// starts a request unless the url already has an entry. anyone asking while
// it's in flight gets the same promise, which is what keeps it to one request.
// never rejects, a failure ends up in the cache as an error entry
const load = (url: string): Promise<void> => {
  const existing = cache.get(url);
  if (existing) {
    return existing.status === 'loading' ? existing.promise : Promise.resolve();
  }

  const promise = fetchJson(url).then(
    (data) => {
      // if the cache got wiped while this was in flight, drop the result
      if (cache.get(url) === entry) setEntry(url, { status: 'success', data });
    },
    (error: unknown) => {
      if (cache.get(url) === entry) {
        setEntry(url, { status: 'error', error: toError(error) });
      }
    },
  );
  const entry: CacheEntry = { status: 'loading', promise };
  setEntry(url, entry);
  return promise;
};

/**
 * 1. Implement a caching fetch hook. The hook should return an object with the following properties:
 * - isLoading: a boolean that is true when the fetch is in progress and false otherwise
 * - data: the data returned from the fetch, or null if the fetch has not completed
 * - error: an error object if the fetch fails, or null if the fetch is successful
 *
 * This hook is called three times on the client:
 *  - 1 in App.tsx
 *  - 2 in Person.tsx
 *  - 3 in Name.tsx
 *
 * Acceptance Criteria:
 * 1. The application at /appWithoutSSRData should properly render, with JavaScript enabled, you should see a list of people.
 * 2. You should only see 1 network request in the browser's network tab when visiting the /appWithoutSSRData route.
 * 3. You have not changed any code outside of this file to achieve this.
 * 4. This file passes a type-check.
 *
 */
export const useCachingFetch: UseCachingFetch = (url) => {
  const subscribeToUrl = useCallback(
    (listener: () => void) => subscribe(url, listener),
    [url],
  );
  const getSnapshot = () => cache.get(url);

  // same snapshot on the server and during hydration, so the first client
  // render matches the server html
  const entry = useSyncExternalStore(subscribeToUrl, getSnapshot, getSnapshot);

  // fetch after mount, not during render. effects don't run on the server,
  // so the server render never fetches. entry is in the deps so it fetches
  // again after wipeCache
  useEffect(() => {
    if (!cache.has(url)) void load(url);
  }, [url, entry]);

  if (!entry || entry.status === 'loading') {
    return { isLoading: true, data: null, error: null };
  }
  if (entry.status === 'error') {
    return { isLoading: false, data: null, error: entry.error };
  }
  return { isLoading: false, data: entry.data, error: null };
};

/**
 * 2. Implement a preloading caching fetch function. The function should fetch the data.
 *
 * This function will be called once on the server before any rendering occurs.
 *
 * Any subsequent call to useCachingFetch should result in the returned data being available immediately.
 * Meaning that the page should be completely serverside rendered on /appWithSSRData
 *
 * Acceptance Criteria:
 * 1. The application at /appWithSSRData should properly render, with JavaScript disabled, you should see a list of people.
 * 2. You have not changed any code outside of this file to achieve this.
 * 3. This file passes a type-check.
 *
 */
export const preloadCachingFetch = async (url: string): Promise<void> => {
  // load() doesn't reject, so a failed preload shows the app's own error
  // message instead of a 500 page
  await load(url);
};

/**
 * 3.1 Implement a serializeCache function that serializes the cache to a string.
 * 3.2 Implement an initializeCache function that initializes the cache from a serialized cache string.
 *
 * Together, these two functions will help the framework transfer your cache to the browser.
 *
 * The framework will call `serializeCache` on the server to serialize the cache to a string and inject it into the dom.
 * The framework will then call `initializeCache` on the browser with the serialized cache string to initialize the cache.
 *
 * Acceptance Criteria:
 * 1. The application at /appWithSSRData should properly render, with JavaScript enabled, you should see a list of people.
 * 2. You should not see any network calls to the people API when visiting the /appWithSSRData route.
 * 3. You have not changed any code outside of this file to achieve this.
 * 4. This file passes a type-check.
 *
 */
export const serializeCache = (): string => {
  const serialized: Record<string, SerializedEntry> = {};
  cache.forEach((entry, url) => {
    // anything still loading is skipped, the browser will just request it
    if (entry.status === 'success') serialized[url] = { data: entry.data };
    if (entry.status === 'error')
      serialized[url] = { error: entry.error.message };
  });

  // the framework puts this string as-is inside
  //   <script>window.__INITIAL_DATA__ = '...'</script>
  // so plain JSON could break out of the quotes or the script tag (O'Kon,
  // "</script>"). encodeURIComponent only leaves safe characters, except
  // the apostrophe, so that gets encoded too
  return encodeURIComponent(JSON.stringify(serialized)).replace(/'/g, '%27');
};

export const initializeCache = (serializedCache: string): void => {
  let parsed: Record<string, SerializedEntry>;
  try {
    parsed = JSON.parse(decodeURIComponent(serializedCache));
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('expected an object');
    }
  } catch (error) {
    // not worth crashing the app over. with an empty cache the components
    // just fetch their data in the browser
    console.error('initializeCache: ignoring bad serialized cache', error);
    return;
  }

  Object.entries(parsed).forEach(([url, value]) => {
    setEntry(
      url,
      'error' in value
        ? { status: 'error', error: new Error(value.error) }
        : { status: 'success', data: value.data },
    );
  });
};

export const wipeCache = (): void => {
  cache.clear();
  // mounted components re-render and fetch again
  listeners.forEach((_, url) => notify(url));
};
