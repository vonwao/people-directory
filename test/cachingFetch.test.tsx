// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initializeCache,
  preloadCachingFetch,
  serializeCache,
  useCachingFetch,
  wipeCache,
} from '../caching-fetch-library/cachingFetch';
import buildHtmlDoc from '../framework/server/buildHtmlDoc';

const PEOPLE_URL = 'https://api.example.test/people';
const OTHER_URL = 'https://api.example.test/other';

const Consumer = ({
  label,
  url = PEOPLE_URL,
}: {
  label: string;
  url?: string;
}) => {
  const { isLoading, data, error } = useCachingFetch(url);
  if (isLoading) return <p>{label}: loading</p>;
  if (error)
    return (
      <p>
        {label}: error {error.message}
      </p>
    );
  return (
    <p>
      {label}: {JSON.stringify(data)}
    </p>
  );
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// U+2028/U+2029 count as line breaks in older JS engines
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const UNSAFE_IN_INLINE_SCRIPT = [
  "'",
  '"',
  '<',
  '>',
  String.fromCharCode(92), // backslash
  LINE_SEPARATOR,
  PARAGRAPH_SEPARATOR,
];

const fetchMock = vi.fn<typeof fetch>();

// runs the framework's real inline script (buildHtmlDoc) and returns what the
// browser would end up with in window.__INITIAL_DATA__
const transferThroughHtml = (serializedCache: string): string => {
  const html = buildHtmlDoc(['', serializedCache]);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('no inline data script in the page');
  const fakeWindow: { __INITIAL_DATA__?: string } = {};
  new Function('window', script)(fakeWindow);
  if (typeof fakeWindow.__INITIAL_DATA__ !== 'string') {
    throw new Error('inline script did not set window.__INITIAL_DATA__');
  }
  return fakeWindow.__INITIAL_DATA__;
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse({ name: 'Ada' }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  // unmount first, otherwise wiping the cache makes mounted components refetch
  cleanup();
  wipeCache();
});

describe('useCachingFetch', () => {
  it('makes one request for several components', async () => {
    render(
      <>
        <Consumer label="app" />
        <Consumer label="person" />
        <Consumer label="name" />
      </>,
    );

    expect(screen.getByText('app: loading')).toBeTruthy();
    expect(await screen.findByText('app: {"name":"Ada"}')).toBeTruthy();
    expect(screen.getByText('person: {"name":"Ada"}')).toBeTruthy();
    expect(screen.getByText('name: {"name":"Ada"}')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the cache for components mounted later', async () => {
    const first = render(<Consumer label="first" />);
    await screen.findByText('first: {"name":"Ada"}');
    first.unmount();

    render(<Consumer label="later" />);
    // no loading state, it's there on the first render
    expect(screen.getByText('later: {"name":"Ada"}')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches different urls separately', async () => {
    fetchMock.mockImplementation(async (input) =>
      jsonResponse({ url: String(input) }),
    );
    render(
      <>
        <Consumer label="a" url={PEOPLE_URL} />
        <Consumer label="b" url={OTHER_URL} />
      </>,
    );

    expect(await screen.findByText(`a: {"url":"${PEOPLE_URL}"}`)).toBeTruthy();
    expect(await screen.findByText(`b: {"url":"${OTHER_URL}"}`)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a 500 as an error', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ message: 'nope' }, 500),
    );
    render(<Consumer label="app" />);

    expect(
      await screen.findByText(/app: error .*failed with status 500/),
    ).toBeTruthy();
  });

  it('handles a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Consumer label="app" />);

    expect(await screen.findByText('app: error Failed to fetch')).toBeTruthy();
  });

  it('fetches again after wipeCache', async () => {
    render(<Consumer label="app" />);
    await screen.findByText('app: {"name":"Ada"}');

    wipeCache();

    await screen.findByText('app: {"name":"Ada"}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('preload and transfer to the browser', () => {
  it('renders preloaded data on the server', async () => {
    await preloadCachingFetch(PEOPLE_URL);

    const html = renderToString(<Consumer label="ssr" />);

    expect(html).toContain('{&quot;name&quot;:&quot;Ada&quot;}');
    expect(html).not.toContain('loading');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('makes one request for two preloads at once', async () => {
    await Promise.all([
      preloadCachingFetch(PEOPLE_URL),
      preloadCachingFetch(PEOPLE_URL),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gets awkward data through the inline script intact', async () => {
    const awkward = {
      text: `O'Kon ${String.fromCharCode(92)} "quoted" </script><script>alert(1)</script> ${LINE_SEPARATOR} ünïcödé 🎉`,
    };
    fetchMock.mockImplementation(async () => jsonResponse(awkward));
    await preloadCachingFetch(PEOPLE_URL);
    const serialized = serializeCache();

    // nothing that could end the string or the script tag
    for (const unsafe of UNSAFE_IN_INLINE_SCRIPT) {
      expect(serialized).not.toContain(unsafe);
    }

    // now pretend to be the browser: empty cache, then the inline script
    wipeCache();
    fetchMock.mockClear();
    initializeCache(transferThroughHtml(serialized));

    const { container } = render(<Consumer label="browser" />);
    // compare exact text, getByText would collapse the odd whitespace
    expect(container.textContent).toBe(`browser: ${JSON.stringify(awkward)}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a failed preload to the browser as an error', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({}, 503));
    await expect(preloadCachingFetch(PEOPLE_URL)).resolves.toBeUndefined();
    const serverHtml = renderToString(<Consumer label="app" />);
    expect(serverHtml).toContain('failed with status 503');

    const serialized = serializeCache();
    wipeCache();
    fetchMock.mockClear();
    initializeCache(transferThroughHtml(serialized));

    render(<Consumer label="app" />);
    expect(
      screen.getByText(/app: error .*failed with status 503/),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores a broken serialized cache and fetches instead', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    expect(() => initializeCache('%E0%A4%A')).not.toThrow();
    expect(() => initializeCache('null')).not.toThrow();
    expect(consoleError).toHaveBeenCalledTimes(2);
    // bad entries inside an otherwise fine object get skipped
    expect(() =>
      initializeCache(encodeURIComponent('{"a":null,"b":1}')),
    ).not.toThrow();

    render(<Consumer label="app" />);
    expect(await screen.findByText('app: {"name":"Ada"}')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
