import { expect, test } from 'bun:test';
import { pickContainerRefusal } from './pick-container-refusal.ts';

test('it passes a project in which Garage and s2-lite both run', () => {
  expect(pickContainerRefusal('garage running\ns2-lite running\n')).toBeNull();
});

test.each([
  { listed: 'garage running\ns2-lite exited\n', refusal: 's2-lite is exited' },
  { listed: 's2-lite running\n', refusal: 'garage is missing' },
  { listed: '', refusal: 'garage is missing, s2-lite is missing' },
])('it names each service that is not running in $listed', (row) => {
  expect(pickContainerRefusal(row.listed)).toBe(row.refusal);
});
