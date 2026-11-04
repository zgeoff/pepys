import { z } from 'zod';
import { buildSpikeRequests } from './build-spike-requests.ts';
import type { SpikeRequest, SystemOneRequest } from './build-spike-requests.ts';

const baseURL = 'https://api.typesafe.ai';
const model = 'jev-1.14.0';
const repeatCount = 5;

const modelSchema = z.object({
  name: z.string(),
  description: z.string(),
  release_date: z.string(),
});

const modelsSchema = z.object({ models: z.array(modelSchema) });

const choiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()),
});

const noulAnswerSchema = z.object({ type: z.literal('noul'), noul: z.number() });
const answerSchema = z.discriminatedUnion('type', [choiceAnswerSchema, noulAnswerSchema]);

const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), answerSchema),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

type SystemOneResponse = z.infer<typeof responseSchema>;

interface RequestReport {
  name: SpikeRequest['name'];
  latenciesMs: number[];
  medianLatencyMs: number;
  responses: SystemOneResponse[];
}

const apiKey = process.env['JEV_API_KEY'];

if (!apiKey) {
  console.error('JEV_API_KEY is not set; the spike needs a TypeSafe API key');
  process.exit(1);
}

const report = await runSpike(apiKey);

console.log(JSON.stringify(report, null, 2));

async function runSpike(key: string) {
  const models = await readModels(key);

  const requests: RequestReport[] = [];

  for (const request of buildSpikeRequests(model)) {
    const latenciesMs: number[] = [];
    const responses: SystemOneResponse[] = [];

    for (let attempt = 0; attempt < repeatCount; attempt += 1) {
      const startedAt = performance.now();

      const response = await readSystemOneResponse(key, request.body);

      latenciesMs.push(Math.round(performance.now() - startedAt));
      responses.push(response);
    }

    requests.push({
      name: request.name,
      latenciesMs,
      medianLatencyMs: pickMedian(latenciesMs),
      responses,
    });
  }

  return { readAt: new Date().toISOString(), requestedModel: model, models, requests };
}

async function readModels(key: string) {
  const response = await fetch(`${baseURL}/v1/models`, {
    headers: { Authorization: `Bearer ${key}` },
  });

  const body: unknown = await response.json();

  if (!response.ok) {
    throw new Error(`GET /v1/models returned ${response.status}: ${JSON.stringify(body)}`);
  }

  return modelsSchema.parse(body);
}

async function readSystemOneResponse(key: string, request: SystemOneRequest) {
  const response = await fetch(`${baseURL}/v1/systemone`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  const body: unknown = await response.json();

  if (!response.ok) {
    throw new Error(`POST /v1/systemone returned ${response.status}: ${JSON.stringify(body)}`);
  }

  return responseSchema.parse(body);
}

function pickMedian(values: number[]) {
  const sorted = values.toSorted((left, right) => left - right);

  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
