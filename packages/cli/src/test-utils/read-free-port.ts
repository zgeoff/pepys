// The port is free when this returns, and another process may take it before the caller binds it.
export function readFreePort(): number {
  const listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data: () => {} } });
  const port = listener.port;

  listener.stop(true);

  return port;
}
