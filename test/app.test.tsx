// @vitest-environment jsdom
// the real app in a simulated browser, against the real mock api. covers the
// request counts from the acceptance criteria without a real browser
import { act, cleanup, render, screen } from '@testing-library/react';
import { setupServer } from 'msw/node';
import React from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import App from '../application/App';
import {
  initializeCache,
  wipeCache,
} from '../caching-fetch-library/cachingFetch';
import { handler } from '../framework/mock-server/handler';
import renderApp from '../framework/server/renderApp';

const mockApi = setupServer(handler);
let peopleRequests = 0;

beforeAll(() => {
  mockApi.listen({ onUnhandledRequest: 'error' });
  mockApi.events.on('request:start', () => {
    peopleRequests += 1;
  });
});

afterAll(() => {
  mockApi.close();
});

beforeEach(() => {
  wipeCache();
  peopleRequests = 0;
});

afterEach(() => {
  cleanup();
  wipeCache();
});

describe('real app in the browser', () => {
  it('makes one request without server data (/appWithoutSSRData)', async () => {
    render(<App />);

    expect(
      await screen.findByText('Kara Schulist', {}, { timeout: 3000 }),
    ).toBeTruthy();
    expect(document.querySelectorAll('h2')).toHaveLength(75);
    expect(peopleRequests).toBe(1);
  });

  it('hydrates the server html with no request and no errors (/appWithSSRData)', async () => {
    const [html, initialData] = await renderApp(true);
    expect(initialData).toBeTruthy();

    // now the browser side: empty cache, data from the page, then hydrate
    wipeCache();
    peopleRequests = 0;
    const consoleError = vi.spyOn(console, 'error');
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    initializeCache(initialData as string);

    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(container, <App />);
    });

    expect(container.querySelectorAll('h2')).toHaveLength(75);
    expect(peopleRequests).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();

    act(() => root?.unmount());
    container.remove();
  });
});
