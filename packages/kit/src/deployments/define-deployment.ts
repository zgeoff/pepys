import type { Deployment, Plugin } from './types.ts';

export function defineDeployment<const Plugins extends readonly Plugin[]>(
  deployment: Deployment<Plugins>,
): Deployment<Plugins> {
  return deployment;
}
