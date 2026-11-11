import { expect, test } from 'bun:test';
import { defineConsumer, defineTable } from '@pepys/kit';
import { buildScriptcProfile } from './build-scriptc-profile.ts';
import { consumerFences } from './consumer-fences.ts';

test('it builds a library profile whose callbacks match the generated read imports', () => {
  const ticketTracker = defineConsumer({
    name: 'ticket_tracker',
    entry: new URL('file:///stub/consumers/stub.ts'),
    input: { mode: 'fact', streams: ['facts.tickets.ticket'] },
    tables: {
      ticket: defineTable({
        columns: { id: { kind: 'entityID' }, title: { kind: 'text' } },
        primaryKey: ['id'],
        indexes: [],
      }),
    },
    entityViews: [],
    reads: ['ticket'],
    links: [],
  });

  const profile = buildScriptcProfile({
    consumer: ticketTracker,
    entry: 'src/consumers/ticket-tracker.ts',
  });

  expect(profile).toStrictEqual({
    profile_format: 1,
    name: 'ticket_tracker',
    entry: 'src/consumers/ticket-tracker.ts',
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

test('it builds a scope profile that exports applyScope and imports the scope read', () => {
  const berthPlan = defineConsumer({
    name: 'berth_plan',
    entry: new URL('file:///stub/consumers/berth-plan.ts'),
    input: { mode: 'scope', scopeKind: 'harbour:berth', streams: ['facts.harbour.berth'] },
    tables: {},
    entityViews: [],
    reads: [],
    links: [],
  });

  const profile = buildScriptcProfile({
    consumer: berthPlan,
    entry: 'src/consumers/berth-plan.ts',
  });

  expect(profile).toStrictEqual({
    profile_format: 1,
    name: 'berth_plan',
    entry: 'src/consumers/berth-plan.ts',
    emission: 'llvm',
    abi: {
      prefix: 'berth_plan_',
      init_symbol: 'berth_plan_init',
      sink_register_symbol: 'berth_plan_sink',
      callback_register_symbol: 'berth_plan_callback',
    },
    callbacks: [
      { name: 'readScopeFactsLength', params: ['string'], returns: 'f64' },
      { name: 'readScopeFactsInto', params: ['string', 'bytes'], returns: 'void' },
    ],
    exports: [
      {
        export: 'applyScope',
        symbol: 'berth_plan_apply_scope',
        params: ['string'],
        returns: 'string',
      },
    ],
    sidecar: {
      wire_version: 1,
      abi_version: 1,
      snapshot_format: 1,
      build_id_symbol: 'berth_plan_build_id',
      abi_version_symbol: 'berth_plan_abi_version',
      model: 'BerthPlanModel',
      // oxlint-disable-next-line zgeoff/no-abbreviated-names
      msg: 'BerthPlanMessage',
    },
    determinism: { fences: consumerFences },
  });
});

test('it leaves out the callback register symbol for a consumer that reads nothing', () => {
  const tideLevel = defineConsumer({
    name: 'tide_level',
    entry: new URL('file:///stub/consumers/tide-level.ts'),
    input: { mode: 'fact', streams: ['facts.tide.reading'] },
    tables: {},
    entityViews: [],
    reads: [],
    links: [],
  });

  const profile = buildScriptcProfile({
    consumer: tideLevel,
    entry: 'src/consumers/tide-level.ts',
  });

  expect(profile).toStrictEqual({
    profile_format: 1,
    name: 'tide_level',
    entry: 'src/consumers/tide-level.ts',
    emission: 'llvm',
    abi: {
      prefix: 'tide_level_',
      init_symbol: 'tide_level_init',
      sink_register_symbol: 'tide_level_sink',
    },
    callbacks: [],
    exports: [
      {
        export: 'applyFact',
        symbol: 'tide_level_apply_fact',
        params: ['string'],
        returns: 'string',
      },
    ],
    sidecar: {
      wire_version: 1,
      abi_version: 1,
      snapshot_format: 1,
      build_id_symbol: 'tide_level_build_id',
      abi_version_symbol: 'tide_level_abi_version',
      model: 'TideLevelModel',
      // oxlint-disable-next-line zgeoff/no-abbreviated-names
      msg: 'TideLevelMessage',
    },
    determinism: { fences: consumerFences },
  });
});
