import { createConsumerVersion, writeCurrentVersion } from '../create-consumer-version.ts';
import { harbourVesselConsumer, harbourVoyageConsumer } from './harbour-plugin.ts';

// Two current consumer files, as the host leaves them: the vessel Tern in one, its voyage 12 to
// the north port and the voyage's two links in the other.
export async function seedHarbourFiles(storeDirectory: string): Promise<void> {
  await createConsumerVersion({
    storeDirectory,
    consumer: harbourVesselConsumer,
    version: 'v1',
    rows: {
      harbour_vessel: [
        { id: 'harbour:vessel:7', name: 'Tern', updated_at: '2026-11-01T08:00:00.000Z' },
      ],
    },
  });

  await createConsumerVersion({
    storeDirectory,
    consumer: harbourVoyageConsumer,
    version: 'v1',
    rows: {
      harbour_voyage: [
        {
          id: 'harbour:voyage:12',
          vessel_id: 'harbour:vessel:7',
          port_id: 'harbour:port:north',
          is_hailed: true,
          departed_at: '2026-11-02T06:00:00.000Z',
        },
      ],
    },
    links: [
      {
        type: 'voyage_of',
        from_id: 'harbour:voyage:12',
        to_id: 'harbour:vessel:7',
        scope: null,
        origin: 'harbour_voyage',
        confidence: 1,
        evidence: 'fact event:evt-2',
      },
      {
        type: 'called_at',
        from_id: 'harbour:voyage:12',
        to_id: 'harbour:port:north',
        scope: null,
        origin: 'harbour_voyage',
        confidence: 1,
        evidence: 'fact event:evt-2',
      },
    ],
  });

  await writeCurrentVersion(storeDirectory, harbourVesselConsumer, 'v1');
  await writeCurrentVersion(storeDirectory, harbourVoyageConsumer, 'v1');
}
