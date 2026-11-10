# People Directory

A small server-rendered React app that lists people from an API. The original brief is in [DevTask.md](DevTask.md).

- `framework/` has the Fastify server, the browser runtime and an [MSW](https://mswjs.io) mock of the API, so everything runs offline.
- `caching-fetch-library/` is the part that was unfinished. It's implemented now.
- `application/` is the directory app itself.

## Running it

You need Node 22 or newer. I used Node 24 (it's in `.nvmrc`).

```bash
npm ci
npm start
```

Then open <http://localhost:3000>.

- `/appWithoutSSRData`: the server sends "Loading..." and the browser fetches the list.
- `/appWithSSRData`: the server fetches the list first and sends the full page along with the data, so the browser doesn't call the API at all.

`npm test` runs the tests. `npm run check` runs everything CI runs: type-check, lint, format check, tests and build.

## How the cache works (Task 2)

App, Person and Name all ask for the same URL. The library keeps one cache, keyed by URL. Each entry is either loading, success or error.

In the browser, the first render returns `isLoading: true`, which is also what the server rendered, so hydration matches. After mount, an effect starts the request and marks the URL as loading right away. Any other component that asks for the same URL sees that entry and doesn't start its own request. So there's one network request, no matter how many components use the URL. Components subscribe with `useSyncExternalStore`, so they all re-render when the result arrives.

On the server, the framework calls `preloadCachingFetch(url)` and waits for it before rendering, so the HTML has the whole list. This works with JavaScript turned off. `serializeCache()` turns the cache into a string for the page, and `initializeCache()` loads it in the browser before hydration, so there's no API request.

Some choices I made:

- Requests start in an effect or in the preload, never during render.
- The serialized cache is URI-encoded. The framework drops the string straight into an inline `<script>` without escaping it. Plain JSON would break on an apostrophe (a name like O'Kon) or on `</script>` in the data, which is an XSS hole. The cost is size, about 1.6x the JSON.
- A failed preload doesn't turn into a 500. The error goes in the cache, and the app shows its own error message.
- Non-2xx responses count as errors, not just network failures.
- If `wipeCache()` runs while a request is still in flight, that late result is dropped.

## What I set up for Task 1, and why

- **A build that works on Windows.** I'm on Windows, and `npm start` failed there because the scripts used `rm`, `mkdir` and `cp`. [scripts/build.mjs](scripts/build.mjs) does the same job in plain Node. It also builds the server with `NODE_ENV=production`. Before, the server was running React's development build, which is slower.
- **Type-checking.** There was a `tsconfig.json`, but TypeScript wasn't installed and nothing ran it. Now `npm run typecheck` runs `tsc --noEmit`.
- **Tests with Vitest.** It handles TypeScript and JSX with no extra setup. The tests cover the library, a server render of the real app, and the real app in a simulated browser (jsdom), including the request counts from the acceptance criteria.
- **ESLint and Prettier.** The React hooks plugin catches missing effect dependencies, which is useful in a hooks library. Prettier is set to match the existing code, so I didn't have to reformat anyone's files.
- **CI.** GitHub Actions runs the type-check, lint, format check, tests and build on Ubuntu and Windows, with Node 22 and 24. Windows is in there because that's where the original build broke.
- **Repeatable installs.** `package-lock.json` is committed, CI uses `npm ci`, and the Node version is in `.nvmrc` and `engines`.
- **MSW worker path.** `package.json` pointed MSW at the wrong folder, so `npm install` created a stray `mockServer/`. I fixed the path and regenerated the worker.

What I'd add next: Playwright tests in a real browser, a dev mode that rebuilds on save, pre-commit hooks, and the port and host set from environment variables.

## Checking it by hand

Besides the tests, I ran `npm start` and checked both routes in Chrome:

- `/appWithoutSSRData`: 75 people listed, and one request to the people API.
- `/appWithSSRData`: `curl` shows all 75 people in the HTML. After hydration there are no API requests and no console errors.

MSW serves the API from a service worker, so in the network tab the request shows up as coming from the service worker.

## Known issues

- One cache for the whole server. This is the main one. Concurrent requests share it, so one request can wipe another's data while its preload is still waiting on the API. With user-specific data, one user could see another user's data. The fix is a cache per request, passed down through React context, which needs framework changes.
- Entries never expire. There's no TTL or refetch, and a failed request stays failed until `wipeCache` or a reload.
- No timeout. If the API hangs, the server response hangs with it.
- The URL is the whole cache key, so request options aren't supported.
- The framework trusts the library to escape the inline data. It should do that itself.
- Mocking is always on, including in production. MSW is about 60% of `client.js`.
- Every Person and Name re-validates the whole list on each render.
- Bad data from the API crashes the page, because there's no error boundary.
- `npm audit` reports advisories in Fastify 4 (which is end of life) and valibot. The affected features aren't used here, but upgrading would be next.

Smaller things: the port and host are hard-coded, list keys are email addresses, and there's no health check or graceful shutdown.

One tooling note: on Windows with Smart App Control turned on, Windows blocks Rollup's native binary, which Vitest uses, so the tests won't start. Running them in WSL works.

## A note on how I worked

This took me longer than the two hours in the brief, and I used an AI coding assistant along the way. I'm happy to walk through any part of it.
