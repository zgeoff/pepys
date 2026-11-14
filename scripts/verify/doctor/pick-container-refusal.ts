const services = ['garage', 's2-lite'] as const;

// Why the compose project fails the doctor, from `docker ps` lines of `<service> <state>`, or null
// when Garage and s2-lite both run.
export function pickContainerRefusal(listed: string): string | null {
  const states = new Map(
    listed
      .split('\n')
      .map((line) => line.trim().split(' '))
      .filter((parts) => parts.length === 2)
      .map(([service, state]) => [service, state]),
  );

  const notRunning = services.filter((service) => states.get(service) !== 'running');

  if (notRunning.length === 0) {
    return null;
  }

  return notRunning
    .map((service) => `${service} is ${states.get(service) ?? 'missing'}`)
    .join(', ');
}
