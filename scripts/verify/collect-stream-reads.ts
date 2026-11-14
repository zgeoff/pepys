export interface StreamLogLine {
  at: string;
  line: string;
}

export interface StreamReadRecord {
  at: string;
  seqNum: number;
  count: number;
}

const readPattern =
  /\/v1\/streams\/(?<stream>[^/?\s]+)\/records\?seq_num=(?<seqNum>\d+)&count=(?<count>\d+)/u;

// The reads of one stream in s2-lite's request log: each starts at `seq_num` and asks for `count`
// records. Appends and tail reads carry no `seq_num`, so they drop out.
export function collectStreamReads(
  lines: readonly StreamLogLine[],
  stream: string,
): StreamReadRecord[] {
  return lines.flatMap((record) => {
    const groups = readPattern.exec(record.line)?.groups;

    if (groups === undefined || groups['stream'] !== stream) {
      return [];
    }

    return [{ at: record.at, seqNum: Number(groups['seqNum']), count: Number(groups['count']) }];
  });
}
