import { expect, test } from 'bun:test';
import {
  harbourVesselConsumer,
  harbourVoyageConsumer,
} from '../test-utils/harbour/harbour-plugin.ts';
import { pickAttachedFiles } from './pick-attached-files.ts';

test('it names each required consumer with no current version', () => {
  const plan = pickAttachedFiles(
    [
      { consumer: harbourVesselConsumer, path: null },
      { consumer: harbourVoyageConsumer, path: null },
    ],
    [],
  );

  expect(plan).toStrictEqual({ kind: 'missing', consumers: ['harbour_vessel', 'harbour_voyage'] });
});

test('it attaches the required files, then each optional one that has a file, once by name', () => {
  const plan = pickAttachedFiles(
    [{ consumer: harbourVesselConsumer, path: '/store/harbour_vessel/v1/consumer.db' }],
    [
      { consumer: harbourVesselConsumer, path: '/store/harbour_vessel/v1/consumer.db' },
      { consumer: harbourVoyageConsumer, path: null },
    ],
  );

  expect(plan).toStrictEqual({
    kind: 'attach',
    files: [{ consumer: harbourVesselConsumer, path: '/store/harbour_vessel/v1/consumer.db' }],
    skipped: ['harbour_voyage'],
  });
});
