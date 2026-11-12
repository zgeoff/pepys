import { githubDeliveryConsumers } from './github-delivery-consumers.ts';
import {
  parsePullRequestDeliveries,
  selectPullRequestDelivery,
} from './select-pull-request-delivery.ts';

// What a query of another plug-in needs to read deliveries: `consumers` for its `reads`, `select`
// for the statement to run on its `db`, and `parse` for the rows of the result.
export const githubDelivery = {
  consumers: githubDeliveryConsumers,
  select: selectPullRequestDelivery,
  parse: parsePullRequestDeliveries,
} as const;
