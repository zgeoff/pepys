export const kitVersion = 1;

// The host's own tables and views in every consumer file, which no consumer may declare. The
// deployment check and the consumer manifest schema both refuse them.
export const hostTableNames = [
  'link',
  'link_effective',
  'entity',
  'offsets',
  'change_log',
  'applied_facts',
  'scope_row',
  'scope_fact',
] as const;
