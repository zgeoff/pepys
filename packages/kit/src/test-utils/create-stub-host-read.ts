import { onTestFinished } from 'bun:test';

interface StubHostRead {
  readonly readLength: (key: string) => number;
  readonly readInto: (key: string, buffer: Uint8Array) => void;
}

// A consumer's glue calls the host functions of a read as globals, as the compiled module imports
// them from the host.
export function createStubHostRead(name: string, rows: ReadonlyMap<string, string>): StubHostRead {
  const encoder = new TextEncoder();

  const lengthName = `read${name}Length`;
  const intoName = `read${name}Into`;

  const hostRead: StubHostRead = {
    readLength: (key) => {
      const row = rows.get(key);

      return row === undefined ? -1 : encoder.encode(row).length;
    },
    readInto: (key, buffer) => {
      buffer.set(encoder.encode(rows.get(key) ?? ''));
    },
  };

  Reflect.set(globalThis, lengthName, hostRead.readLength);
  Reflect.set(globalThis, intoName, hostRead.readInto);

  onTestFinished(() => {
    Reflect.deleteProperty(globalThis, lengthName);
    Reflect.deleteProperty(globalThis, intoName);
  });

  return hostRead;
}
