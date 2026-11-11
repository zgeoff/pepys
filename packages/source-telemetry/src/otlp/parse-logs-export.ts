import { isRecord } from '@zgeoff/std';
import type { LogsExport, OtlpKeyValue, OtlpLogRecord, ResourceLogs, ScopeLogs } from './types.ts';

// The export in a JSON body, or undefined for a value that is no logs export at all. Inside an
// export, a part of the wrong shape is skipped, so one odd record never refuses the others: an
// exporter drops an export that gets a 4xx answer.
export function parseLogsExport(value: unknown): LogsExport | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const resourceLogs = value['resourceLogs'];

  if (resourceLogs === undefined) {
    return { resourceLogs: [] };
  }

  if (!Array.isArray(resourceLogs)) {
    return undefined;
  }

  return { resourceLogs: collectObjects(resourceLogs).map((item) => parseResourceLogs(item)) };
}

type JSONObject = Readonly<Record<string, unknown>>;

function collectObjects(value: unknown): JSONObject[] {
  const items: readonly unknown[] = Array.isArray(value) ? value : [];

  return items.filter((item): item is JSONObject => isRecord(item));
}

function parseResourceLogs(value: JSONObject): ResourceLogs {
  const resource = value['resource'];
  const attributes = isRecord(resource) ? resource['attributes'] : undefined;

  return {
    resource: { attributes: parseAttributes(attributes) },
    scopeLogs: collectObjects(value['scopeLogs']).map((item) => parseScopeLogs(item)),
  };
}

function parseAttributes(value: unknown): OtlpKeyValue[] {
  return collectObjects(value).flatMap((entry) => {
    const key = entry['key'];

    return typeof key === 'string' ? [{ key, value: entry['value'] }] : [];
  });
}

function parseScopeLogs(value: JSONObject): ScopeLogs {
  const scope = isRecord(value['scope']) ? value['scope'] : {};
  const name = scope['name'];
  const version = scope['version'];

  return {
    scope: {
      name: typeof name === 'string' ? name : '',
      ...(typeof version === 'string' ? { version } : {}),
    },
    logRecords: collectObjects(value['logRecords']).map((item) => parseLogRecord(item)),
  };
}

function parseLogRecord(value: JSONObject): OtlpLogRecord {
  if (value['attributes'] === undefined) {
    return { ...value, attributes: undefined };
  }

  return { ...value, attributes: parseAttributes(value['attributes']) };
}
