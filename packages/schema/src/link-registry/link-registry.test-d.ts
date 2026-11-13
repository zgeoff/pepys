import type { LinkTypeDeclaration } from '@pepys/kit';
import type { KindedID, LinkEnds, LinkRegistryOf } from './link-registry.ts';

// Two link types, so a kind that one type allows and the other refuses tells a check of the pairing
// from a check of the kinds the registry knows at all. Each refused link differs from the valid one
// in one property.
type Registry = LinkRegistryOf<
  | LinkTypeDeclaration<'buoy_moored_at', 'tide:buoy', 'tide:station'>
  | LinkTypeDeclaration<'station_reports_to', 'tide:station', 'tide:office'>
>;

declare const buoy: KindedID<'tide:buoy'>;
declare const station: KindedID<'tide:station'>;
declare const office: KindedID<'tide:office'>;

export const validLink: LinkEnds<Registry> = {
  type: 'buoy_moored_at',
  from: buoy,
  to: { kind: 'entity', id: station },
};

// @ts-expect-error buoy_moored_at starts at a buoy, never at a station
export const fromKindTheTypeRefuses: LinkEnds<Registry> = {
  type: 'buoy_moored_at',
  from: station,
  to: { kind: 'entity', id: station },
};

// @ts-expect-error buoy_moored_at ends at a station, never at an office
export const toKindTheTypeRefuses: LinkEnds<Registry> = {
  type: 'buoy_moored_at',
  from: buoy,
  to: { kind: 'entity', id: office },
};

export const unknownLinkType: LinkEnds<Registry> = {
  // @ts-expect-error the registry declares no buoy_sank link type
  type: 'buoy_sank',
  from: buoy,
  to: { kind: 'entity', id: station },
};
