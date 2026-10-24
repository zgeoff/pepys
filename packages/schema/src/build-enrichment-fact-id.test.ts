import { expect, test } from 'bun:test';
import { buildEnrichmentFactID } from './build-enrichment-fact-id.ts';
import { parseEntityID } from './parse-entity-id.ts';

test('it starts an enrichment fact ID with its kind and a sha256 hex digest', () => {
  expect(buildEnrichmentFactID({ job: 'summarise', jobVersion: '3', inputHash: 'ab12' })).toMatch(
    /^enrichment:[0-9a-f]{64}$/u,
  );
});

test('it gives the same ID for the same inputs', () => {
  const parts = { job: 'summarise', jobVersion: '3', inputHash: 'ab12' };

  expect(buildEnrichmentFactID(parts)).toStrictEqual(buildEnrichmentFactID(parts));
});

test('it gives another ID for another job version', () => {
  expect(buildEnrichmentFactID({ job: 'summarise', jobVersion: '3', inputHash: 'ab12' })).not.toBe(
    buildEnrichmentFactID({ job: 'summarise', jobVersion: '4', inputHash: 'ab12' }),
  );
});

test('it does not let a field move its boundary into the next field', () => {
  expect(buildEnrichmentFactID({ job: 'a', jobVersion: 'bc', inputHash: 'd' })).not.toBe(
    buildEnrichmentFactID({ job: 'ab', jobVersion: 'c', inputHash: 'd' }),
  );
});

test('it gives an ID that is not an entity ID', () => {
  const factID = buildEnrichmentFactID({ job: 'summarise', jobVersion: '3', inputHash: 'ab12' });

  expect(parseEntityID(factID).ok).toBe(false);
});
