import type { ReceivePath } from '@pepys/kit';
import { match } from 'ts-pattern';

// 'status': 200 {"status":"stored","stored":<n>}, or 202 {"status":"ignored"}. 'empty': 200 {} for
// both, which an OTLP exporter expects.
export function buildSuccessAnswer(
  path: ReceivePath,
  outcome: 'stored' | 'ignored',
  count: number,
): Response {
  return match(path.answer ?? 'status')
    .with('empty', () => Response.json({}, { status: 200 }))
    .with('status', () =>
      outcome === 'stored'
        ? Response.json({ status: 'stored', stored: count }, { status: 200 })
        : Response.json({ status: 'ignored' }, { status: 202 }),
    )
    .exhaustive();
}
