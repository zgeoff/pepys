import type { Delivery } from './read-app-deliveries.ts';

export interface DeliverySummary {
  readonly readAt: string;
  readonly deliveryCount: number;
  readonly failedCount: number;
  readonly redeliveryCount: number;
  readonly oldestDeliveredAt: string | null;
  readonly newestDeliveredAt: string | null;
  readonly oldestAgeHours: number | null;
}

const hourMs = 3_600_000;

// Holds counts and times only, so the output names no repository, event or delivery GUID.
export function buildDeliverySummary(deliveries: readonly Delivery[], now: Date): DeliverySummary {
  const times = deliveries.map((delivery) => delivery.deliveredAt.getTime());
  const oldestMs = times.length === 0 ? null : Math.min(...times);
  const newestMs = times.length === 0 ? null : Math.max(...times);

  return {
    readAt: now.toISOString(),
    deliveryCount: deliveries.length,

    // A delivery that got no response has status code 0, so the code alone misses it.
    failedCount: deliveries.filter((delivery) => delivery.status !== 'OK').length,
    redeliveryCount: deliveries.filter((delivery) => delivery.redelivery).length,
    oldestDeliveredAt: oldestMs === null ? null : new Date(oldestMs).toISOString(),
    newestDeliveredAt: newestMs === null ? null : new Date(newestMs).toISOString(),
    oldestAgeHours:
      oldestMs === null ? null : Math.round(((now.getTime() - oldestMs) / hourMs) * 10) / 10,
  };
}
