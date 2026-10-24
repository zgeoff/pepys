import { expect, test } from 'bun:test';
import { defineConsumer, defineTable } from '@pepys/schema';
import { buildConsumerProfile } from './build-consumer-profile.ts';
import { consumerFences } from './consumer-fences.ts';

test('it builds a library profile whose callbacks match the generated read imports', () => {
  const ticketTracker = defineConsumer({
    name: 'ticket_tracker',
    mode: 'fact',
    streams: ['facts.tickets.ticket'],
    tables: {
      ticket: defineTable({
        columns: { id: { kind: 'entityID' }, title: { kind: 'text' } },
        primaryKey: ['id'],
        indexes: [],
      }),
    },
    reads: ['ticket'],
  });

  const profile = buildConsumerProfile({
    consumer: ticketTracker,
    entry: '/work/ticket-tracker.ts',
  });

  expect(profile).toStrictEqual({
    profile_format: 1,
    name: 'ticket_tracker',
    entry: '/work/ticket-tracker.ts',
    emission: 'llvm',
    abi: {
      prefix: 'ticket_tracker_',
      init_symbol: 'ticket_tracker_init',
      sink_register_symbol: 'ticket_tracker_sink',
      callback_register_symbol: 'ticket_tracker_callback',
    },
    callbacks: [
      { name: 'readTicketLength', params: ['string'], returns: 'f64' },
      { name: 'readTicketInto', params: ['string', 'bytes'], returns: 'void' },
    ],
    exports: [
      {
        export: 'applyFact',
        symbol: 'ticket_tracker_apply_fact',
        params: ['string'],
        returns: 'string',
      },
    ],
    sidecar: {
      wire_version: 1,
      abi_version: 1,
      snapshot_format: 1,
      build_id_symbol: 'ticket_tracker_build_id',
      abi_version_symbol: 'ticket_tracker_abi_version',
      model: 'TicketTrackerModel',
      // oxlint-disable-next-line zgeoff/no-abbreviated-names
      msg: 'TicketTrackerMessage',
    },
    determinism: { fences: consumerFences },
  });
});
