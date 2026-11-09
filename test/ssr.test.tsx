// renders the real app on the server against the real mock API handler.
// same thing the two routes do, without starting the http server
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { wipeCache } from '../caching-fetch-library/cachingFetch';
import { handler } from '../framework/mock-server/handler';
import buildHtmlDoc from '../framework/server/buildHtmlDoc';
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
  // the framework wipes the cache at the start of every page request
  wipeCache();
  peopleRequests = 0;
});

describe('server render', () => {
  it('renders all 75 people when preloaded', async () => {
    const [html, initialData] = await renderApp(true);

    expect(html).toContain('Welcome to the People Directory');
    expect(html).toContain('Arturo');
    expect(html).toContain('Kara');
    expect(html.match(/<h2>/g)).toHaveLength(75);
    expect(html).not.toContain('Loading...');
    expect(peopleRequests).toBe(1);

    expect(initialData).toBeTruthy();
    expect(buildHtmlDoc([html, initialData])).toContain(
      `window.__INITIAL_DATA__ = '${initialData}'`,
    );
  });

  it('renders loading with no request when not preloaded', async () => {
    const [html, initialData] = await renderApp(false);

    expect(html).toContain('Loading...');
    expect(initialData).toBeUndefined();
    expect(peopleRequests).toBe(0);
  });
});
