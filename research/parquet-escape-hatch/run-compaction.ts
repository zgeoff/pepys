import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { S2Stream } from '@s2-dev/streamstore';
import { parquetWriteBuffer } from 'hyparquet-writer';

interface CompactionParameters {
  stream: S2Stream;
  streamName: string;
  lakeDirectory: string;
}

export interface CompactionReport {
  fromSeqNum: number;
  nextSeqNum: number;
  files: string[];
  bytes: number;
}

// Copies the records after the recorded offset, up to the tail read at the start, into one
// Parquet file per UTC day of the record's timestamp, then records the offset. A crash between
// the two writes makes the next run copy records again, which the rebuild refuses as an overlap.
export async function runCompaction(parameters: CompactionParameters): Promise<CompactionReport> {
  const streamDirectory = join(parameters.lakeDirectory, parameters.streamName);
  const offsetFile = Bun.file(join(streamDirectory, 'offset.json'));

  const hasOffset = await offsetFile.exists();

  const offset: unknown = hasOffset ? await offsetFile.json() : null;
  const fromSeqNum = hasOffset ? readNextSeqNum(offset) : 0;

  const tail = await parameters.stream.checkTail();
  const records = await readRecords(parameters.stream, fromSeqNum, tail.tail.seqNum);

  const files: string[] = [];
  let bytes = 0;

  for (const [day, dayRecords] of Map.groupBy(records, (record) => formatDay(record.timestamp))) {
    const [first] = dayRecords;
    const last = dayRecords.at(-1);

    if (first === undefined || last === undefined) {
      continue;
    }

    const name = `${formatSeqNum(first.seqNum)}-${formatSeqNum(last.seqNum)}.parquet`;
    const path = join(streamDirectory, day, name);

    await mkdir(join(streamDirectory, day), { recursive: true });

    const buffer = parquetWriteBuffer({
      columnData: [
        {
          name: 'seq_num',
          data: dayRecords.map((record) => BigInt(record.seqNum)),
          type: 'INT64',
          nullable: false,
        },
        {
          name: 'timestamp',
          data: dayRecords.map((record) => record.timestamp),
          type: 'TIMESTAMP',
          nullable: false,
        },
        {
          name: 'body',
          data: dayRecords.map((record) => record.body),
          type: 'STRING',
          nullable: false,
        },
      ],
    });

    bytes += await Bun.write(path, buffer);

    files.push(join(day, name));
  }

  const nextSeqNum = fromSeqNum + records.length;

  await Bun.write(offsetFile, JSON.stringify({ nextSeqNum }));

  return { fromSeqNum, nextSeqNum, files, bytes };
}

function readNextSeqNum(offset: unknown): number {
  if (
    typeof offset !== 'object' ||
    offset === null ||
    !('nextSeqNum' in offset) ||
    typeof offset.nextSeqNum !== 'number'
  ) {
    throw new Error('the lake offset file has no nextSeqNum');
  }

  return offset.nextSeqNum;
}

interface LakeRecord {
  seqNum: number;
  timestamp: Date;
  body: string;
}

const readPageCount = 1000;

async function readRecords(
  stream: S2Stream,
  fromSeqNum: number,
  stopSeqNum: number,
): Promise<LakeRecord[]> {
  const records: LakeRecord[] = [];

  while (fromSeqNum + records.length < stopSeqNum) {
    const next = fromSeqNum + records.length;

    const batch = await stream.read({
      start: { from: { seqNum: next } },
      stop: { limits: { count: Math.min(readPageCount, stopSeqNum - next) } },
    });

    if (batch.records.length === 0) {
      throw new Error(`the stream returned no record at ${next}, below its tail ${stopSeqNum}`);
    }

    for (const record of batch.records) {
      records.push({ seqNum: record.seqNum, timestamp: record.timestamp, body: record.body });
    }
  }

  return records;
}

function formatDay(timestamp: Date): string {
  return timestamp.toISOString().slice(0, 10);
}

function formatSeqNum(seqNum: number): string {
  return String(seqNum).padStart(12, '0');
}
