import { FetchInterceptor } from '@mswjs/interceptors/fetch/web';
import { HttpNetworkFrame, InterceptorSource, defineNetwork } from 'msw/experimental';
import invariant from 'tiny-invariant';
import { githubAPIHandlers } from './github-api-handlers.ts';

const loopbackHosts = new Set(['127.0.0.1', '[::1]', 'localhost']);

// Only the `fetch/web` entry patches Bun's global `fetch`; the default entry lets every request
// reach the real network. That entry declares its own Interceptor class, so the guard below
// gives msw's InterceptorSource the type it asks for.
const fetchInterceptor: unknown = new FetchInterceptor();

invariant(isSourceInterceptor(fetchInterceptor), 'the fetch interceptor applies and disposes');

// The one mock network of a test process.
export const mockNetwork = defineNetwork({
  sources: [new InterceptorSource({ interceptors: [fetchInterceptor] })],
  handlers: [...githubAPIHandlers],
  context: { quiet: true },

  // The ingest, API and stack tests call servers they start on ephemeral loopback ports, so a
  // loopback request passes. A request to any other host that no handler matches rejects.
  onUnhandledFrame: (unhandled) => {
    const frame = unhandled.frame;
    const url = frame instanceof HttpNetworkFrame ? new URL(frame.data.request.url) : null;

    if (url !== null && loopbackHosts.has(url.hostname)) {
      return;
    }

    unhandled.defaults.error();
    throw new Error('the test sent a request that no handler matches');
  },
});

type SourceInterceptor = ConstructorParameters<typeof InterceptorSource>[0]['interceptors'][number];

function isSourceInterceptor(value: unknown): value is SourceInterceptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'apply' in value &&
    'dispose' in value &&
    'on' in value
  );
}
