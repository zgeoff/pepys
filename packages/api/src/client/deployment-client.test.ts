import { expectTypeOf, test } from 'bun:test';
import type { CoreInputs, CoreOutputs } from '@pepys/contract';
import { defineDeployment, definePlugin } from '@pepys/kit';
import { harbourPlugin } from '../test-utils/harbour/harbour-plugin.ts';
import type { DeploymentClient } from './deployment-client.ts';

test('it types the core procedures and the queries of each plug-in, one with no queries', () => {
  const deployment = defineDeployment({
    name: 'harbour',
    plugins: [harbourPlugin, definePlugin({ name: 'lighthouse' })],
  });

  type Client = DeploymentClient<typeof deployment>;

  expectTypeOf<Parameters<Client['neighbourhood']>[0]>().toEqualTypeOf<
    CoreInputs['neighbourhood']
  >();

  expectTypeOf<Awaited<ReturnType<Client['get_entity']>>>().toEqualTypeOf<
    CoreOutputs['get_entity']
  >();

  expectTypeOf<Client['harbour_voyage_count']>().toEqualTypeOf<
    (input: VoyageCountInput) => Promise<{ count: number }>
  >();

  expectTypeOf<Client['harbour_vessel_ports']>().toEqualTypeOf<
    (input: Record<string, never>) => Promise<{
      ports: { name: string; port: string; title: string }[];
    }>
  >();

  expectTypeOf<keyof Client>().toEqualTypeOf<
    'get_entity' | 'neighbourhood' | 'harbour_voyage_count' | 'harbour_vessel_ports'
  >();
});

interface VoyageCountInput {
  vessel: string;
}
