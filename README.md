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

Other scripts:

- `npm test` runs the tests once (`npm run test:watch` keeps them running).
- `npm run typecheck`, `npm run lint` and `npm run format` do what they say.
- `npm run check` runs everything CI runs: type-check, lint, format check, tests and build.

## How the cache works

App, Person and Name all ask for the same URL. The library keeps one cache, keyed by URL. Each entry is either loading, success or error.

In the browser (`/appWithoutSSRData`):

1. The first render finds nothing cached, so the hook returns `isLoading: true`. That's also what the server rendered, so hydration matches.
2. After mount, an effect starts the request and puts the promise in the cache right away. The other components find that entry and wait on the same promise instead of starting their own request. So there's one network request, no matter how many components use the URL.
3. When the request finishes, the entry becomes success or error, and every component using it re-renders. Components subscribe with `useSyncExternalStore`, which is React's built-in way to read from a store that lives outside React.

On the server (`/appWithSSRData`):

1. The framework calls `preloadCachingFetch(url)` and waits for it before rendering.
2. `renderToString` finds the data in the cache, so the HTML has the whole list. This works with JavaScript turned off.
3. `serializeCache()` turns the cache into a string, and the framework puts it in the page. In the browser, `initializeCache()` loads it before hydration. The first render already has the data, so there's no API request.

A few decisions worth mentioning:

- **No fetching during render.** Requests start in an effect or in the preload, never while rendering. Rendering stays free of side effects, and a server render that wasn't preloaded never makes a request.
- **The serialized cache is URI-encoded.** The framework drops the string straight into `<script>window.__INITIAL_DATA__ = '...'</script>` without escaping it. Plain JSON would break on an apostrophe (a name like O'Kon) or on `</script>` in the data, which is an XSS hole. `encodeURIComponent` leaves only characters that are safe there, plus the apostrophe, which I encode as `%27`. The cost is size: about 1.6x the JSON (18 KB instead of 11 KB here). I think that's fine for this.
- **A failed preload doesn't turn into a 500.** The error goes in the cache, and the app shows its own error message. The error also goes to the browser with the rest of the cache, so hydration still matches.
- **Non-2xx responses count as errors**, not just network failures.
- **Late results get dropped.** If `wipeCache()` runs while a request is still in flight, that result doesn't end up in the new cache.

## What I set up for Task 1, and why

- **A build that works on Windows.** I'm on Windows, and `npm start` failed there because the scripts used `rm`, `mkdir` and `cp`. They also pointed at `index.js` files that don't exist (esbuild was quietly picking up the `.ts` files instead). [scripts/build.mjs](scripts/build.mjs) does the same job in plain Node. It also builds the browser bundle with `NODE_ENV=production` so React ships its production build, and it adds source maps to the server bundle.
- **Type-checking.** There was a `tsconfig.json`, but TypeScript wasn't installed and nothing ran it. Now `npm run typecheck` runs `tsc --noEmit`. I updated the config to match how the code is actually built: esbuild and Vitest compile, and TypeScript only checks.
- **Tests with Vitest.** It handles TypeScript and JSX with no extra setup. [test/cachingFetch.test.tsx](test/cachingFetch.test.tsx) covers the library: one shared request, cache hits, errors, `wipeCache`, preloading, and the round trip through the framework's real inline script with awkward characters. [test/ssr.test.tsx](test/ssr.test.tsx) server-renders the real app against the mock API and checks that all 75 people are in the HTML, with one API request.
- **ESLint and Prettier.** ESLint uses `typescript-eslint` and the React hooks plugin, which catches missing effect dependencies. That's useful in a hooks library. Prettier is set to match the existing code (single quotes), so I didn't have to reformat anyone's files.
- **CI.** A GitHub Actions workflow runs the type-check, lint, format check, tests and build on Ubuntu and Windows, with Node 22 and 24. Windows is in there because that's where the original build broke.
- **Repeatable installs.** `package-lock.json` is committed, CI uses `npm ci`, and the Node version is in `.nvmrc` and `engines`. `.gitattributes` and `.editorconfig` keep line endings and indentation the same across operating systems.
- **MSW worker path.** `package.json` told MSW the worker lived in `mockServer/`, so `npm install` created a stray `mockServer/` folder. The worker actually lives in `framework/mock-server/`. I fixed the path and regenerated the worker with `npx msw init`, so it matches the installed MSW version.
- The package is marked `private`, so it can't get published to npm by accident.

What I'd add next:

- Browser tests (Playwright) for the two checks that need a real browser: counting API requests and rendering with JavaScript off. I checked those by hand (see below).
- A dev mode that rebuilds on save.
- Pre-commit hooks for lint and format, and Dependabot or Renovate for dependency updates.
- Port, host and mocking set from environment variables, and a Dockerfile.

## How I checked the acceptance criteria

Besides the tests, I ran `npm start` and checked:

| Route                | Check                                | Result        |
| -------------------- | ------------------------------------ | ------------- |
| `/appWithoutSSRData` | People listed                        | 75            |
| `/appWithoutSSRData` | People API requests in the browser   | 1             |
| `/appWithSSRData`    | HTML with no JavaScript run (`curl`) | All 75 people |
| `/appWithSSRData`    | People API requests after hydration  | 0             |
| `/appWithSSRData`    | Console errors or hydration warnings | None          |

MSW serves the API from a service worker, so in the network tab the request shows up as coming from the service worker.

## Known issues

In the library:

- **One cache for the whole server.** The framework wipes it at the start of each page request, but concurrent requests still share it. One request can wipe another's data between the preload and the render, and that page renders "Loading..." instead. With user-specific data, one user could see another user's data. The fix is a cache per request, created in `renderApp` and passed down through React context. That needs framework changes, which the task ruled out.
- **Entries never expire.** There's no TTL or refetch, and a failed request stays failed until `wipeCache`. The fixed API (`useCachingFetch(url)`) doesn't leave room for options.
- **No timeout.** If the API hangs, the server response hangs with it. An `AbortSignal.timeout` on the fetch would fix that.
- **The URL is the whole cache key.** Request options aren't supported, and the same query params in a different order count as a different URL.
- **Everyone shares the same data object.** If one component mutates it, it changes for everyone.

In the framework and the app:

- **The framework trusts the library to escape the inline data.** Another implementation that returns plain JSON would be an XSS hole. The framework should handle this itself, for example with `<script type="application/json">` and `<` escaped.
- **Mocking is always on**, including in production. MSW is about 60% of `client.js`, and the browser waits for the service worker to register before hydrating. It should only run in development and tests.
- **Validation runs too often.** Every Person and Name re-validates the whole list: 151 validations of 75 records per render. Validating once in App and passing the people down would fix it.
- **Hard-coded port and paths.** Port 3000 and host `localhost` are fixed, and the server has to be started from the repo root.
- **Missing production basics**: a health check, graceful shutdown and security headers.
- **List keys are email addresses**, so two people with the same email would collide.

One tooling note: on Windows with Smart App Control turned on, Windows blocks Rollup's native binary, which Vitest uses, so the tests won't start. Running them in WSL works.
