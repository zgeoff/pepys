interface StreamCounts {
  pulledBytes: number;
  isCancelled: boolean;
}

export function buildStubCountedStream(
  bytes: Uint8Array<ArrayBuffer>,
  chunkBytes: number,
): { stream: ReadableStream<Uint8Array<ArrayBuffer>>; counts: Readonly<StreamCounts> } {
  const counts: StreamCounts = { pulledBytes: 0, isCancelled: false };

  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull: (controller) => {
      if (counts.pulledBytes >= bytes.byteLength) {
        controller.close();

        return;
      }

      const chunk = bytes.subarray(counts.pulledBytes, counts.pulledBytes + chunkBytes);

      counts.pulledBytes += chunk.byteLength;

      controller.enqueue(chunk);
    },
    cancel: () => {
      counts.isCancelled = true;
    },
  });

  return { stream, counts };
}
