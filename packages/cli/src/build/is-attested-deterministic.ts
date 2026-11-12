// `contract` is the parsed `<module>.contract.json` that scriptc writes beside a module
export function isAttestedDeterministic(contract: unknown): boolean {
  return (
    typeof contract === 'object' &&
    contract !== null &&
    'deterministic' in contract &&
    contract.deterministic === true
  );
}
