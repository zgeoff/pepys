import { availableParallelism, cpus } from 'node:os';
import { AutoModel, AutoTokenizer, Tensor, env } from '@huggingface/transformers';
import type { PreTrainedModel, PreTrainedTokenizer } from '@huggingface/transformers';
import { buildCosine } from './build-cosine.ts';
import { buildRankingResult } from './build-ranking-result.ts';
import { buildTimingSummary } from './build-timing-summary.ts';
import type { TimingSummary } from './build-timing-summary.ts';
import { emails } from './emails.ts';
import { queries } from './queries.ts';

// The model card's repo and the commit the spike ran against.
const modelID = 'MongoDB/mdbr-leaf-ir';
const modelRevision = '4262131b32c3182bd06e67e92ae69d7bd66e0c5c';

// From config_sentence_transformers.json and sentence_bert_config.json in the model repo.
const queryPrefix = 'Represent this sentence for searching relevant passages: ';
const maxTokens = 512;
const dtypes = ['fp32', 'q8'] as const;
const threadCounts = [1, 4, 0] as const;
const batchSize = 16;
const timingRounds = 3;
const topCount = 3;
const cardTolerance = 0.001;

// The model card's Transformers.js example and the scores it prints.
const cardQueries = ['What is machine learning?', 'How does neural network training work?'];

const cardDocuments = [
  'Machine learning is a subset of artificial intelligence that focuses on algorithms that can learn from data.',
  'Neural networks are trained through backpropagation, adjusting weights to minimize prediction errors.',
];

const cardScores = [
  [0.6857, 0.4598],
  [0.4238, 0.5723],
];

const dailyVolumes = [200, 1000] as const;

type DType = (typeof dtypes)[number];

interface Encoder {
  tokenizer: PreTrainedTokenizer;
  model: PreTrainedModel;
}

env.cacheDir = `${import.meta.dir}/.cache`;

const exitCode = await runSpike();

process.exit(exitCode);

async function runSpike(): Promise<number> {
  const cpu = cpus()[0]?.model ?? 'unknown';

  console.log(`Bun ${Bun.version} on ${process.platform}-${process.arch}`);
  console.log(`CPU: ${cpu}, ${availableParallelism()} logical CPUs`);
  console.log(`transformers.js entry: ${import.meta.resolve('@huggingface/transformers')}`);
  console.log(`Model: ${modelID}@${modelRevision}`);

  const isCacheWarm = await Bun.file(
    `${env.cacheDir}/${modelID}/${modelRevision}/config.json`,
  ).exists();

  console.log(`Model cache: ${isCacheWarm ? 'warm' : 'cold, so the first load downloads'}`);

  const failures: string[] = [];

  for (const dtype of dtypes) {
    failures.push(...(await runDTypeChecks(dtype)));
  }

  const nativeLibraries = await readNativeOnnxLibraries();

  if (nativeLibraries === null) {
    console.log('\nnative ONNX libraries: unchecked, because /proc/self/maps exists only on Linux');
  } else {
    console.log(`\nnative ONNX libraries mapped into the process: ${nativeLibraries.join(', ')}`);
  }

  if (nativeLibraries?.length === 0) {
    failures.push('onnxruntime-node is not loaded, so the WASM backend ran');
  }

  const verdict = failures.length === 0 ? 'PASS' : `FAIL\n- ${failures.join('\n- ')}`;

  console.log(`\n${verdict}`);

  return failures.length === 0 ? 0 : 1;
}

async function runDTypeChecks(dtype: DType): Promise<string[]> {
  console.log(`\n== dtype ${dtype}`);

  const failures: string[] = [];
  const loadStart = performance.now();

  const encoder = await readEncoder(dtype, 0);

  const loadMs = performance.now() - loadStart;

  console.log(`load: ${loadMs.toFixed(0)} ms`);

  const cardDeviation = await readCardDeviation(encoder);

  console.log(`card check: largest deviation from the card's scores ${cardDeviation.toFixed(5)}`);

  if (dtype === 'fp32' && cardDeviation > cardTolerance) {
    failures.push(`fp32 scores differ from the model card by ${cardDeviation.toFixed(5)}`);
  }

  const emailTexts = emails.map((email) => `${email.subject}\n\n${email.body}`);
  const queryTexts = queries.map((query) => `${queryPrefix}${query.text}`);
  const tokenCounts = emailTexts.map((text) => encoder.tokenizer.encode(text).length);

  console.log(
    `email tokens: min ${Math.min(...tokenCounts)}, max ${Math.max(...tokenCounts)}, ` +
      `${tokenCounts.filter((count) => count > maxTokens).length} over ${maxTokens} and truncated`,
  );

  const firstStart = performance.now();

  await readEmbeddings(encoder, [emailTexts[0] ?? '']);

  console.log(`first embedding after load: ${(performance.now() - firstStart).toFixed(1)} ms`);

  const single = await readSingleEmbeddings(encoder, emailTexts);

  console.log(`one email at a time, round 1: ${formatTimingSummary(single.timing)}`);

  for (let round = 2; round <= timingRounds; round += 1) {
    const repeat = await readSingleEmbeddings(encoder, emailTexts);

    console.log(`one email at a time, round ${round}: ${formatTimingSummary(repeat.timing)}`);
  }

  const singleQueries = await readSingleEmbeddings(encoder, queryTexts);

  console.log(`one query at a time: ${formatTimingSummary(singleQueries.timing)}`);

  const batchStart = performance.now();
  const batched: number[][] = [];

  for (let index = 0; index < emailTexts.length; index += batchSize) {
    batched.push(...(await readEmbeddings(encoder, emailTexts.slice(index, index + batchSize))));
  }

  const batchMs = performance.now() - batchStart;

  console.log(
    `batches of ${batchSize}: 100 emails in ${batchMs.toFixed(0)} ms, ` +
      `${(batchMs / emailTexts.length).toFixed(1)} ms per email`,
  );

  const batchAgreement = Math.min(
    ...batched.map((vector, index) => buildCosine(vector, single.vectors[index] ?? [])),
  );

  console.log(
    `lowest cosine between an email's batched and single vector: ${batchAgreement.toFixed(6)}`,
  );

  for (const volume of dailyVolumes) {
    console.log(
      `projection: ${volume} emails one at a time take ` +
        `${((single.timing.medianMs * volume) / 60_000).toFixed(2)} min at the median`,
    );
  }

  const ranking = buildRankingResult({
    queries: queries.map((query, index) => ({
      text: query.text,
      targetID: query.targetID,
      vector: singleQueries.vectors[index] ?? [],
    })),
    emails: emails.map((email, index) => ({ id: email.id, vector: single.vectors[index] ?? [] })),
    topCount,
  });

  console.log(
    `ranking: target first for ${ranking.hitsAt1}/20, in top 5 for ${ranking.hitsAt5}/20`,
  );

  for (const entry of ranking.rankings) {
    const top = entry.top
      .map((ranked) => `${ranked.emailID} ${ranked.score.toFixed(3)} ${getSubject(ranked.emailID)}`)
      .join(' | ');

    console.log(`  [rank ${entry.targetRank}] "${entry.query}" -> ${top}`);
  }

  if (dtype === 'fp32') {
    await runThreadSweep(emailTexts);
  }

  return failures;
}

async function readEncoder(dtype: DType, intraOpNumThreads: number): Promise<Encoder> {
  const tokenizer = await AutoTokenizer.from_pretrained(modelID, { revision: modelRevision });

  const model = await AutoModel.from_pretrained(modelID, {
    revision: modelRevision,
    device: 'cpu',
    dtype,
    session_options: intraOpNumThreads === 0 ? {} : { intraOpNumThreads },
  });

  return { tokenizer, model };
}

async function readCardDeviation(encoder: Encoder): Promise<number> {
  const queryVectors = await readEmbeddings(
    encoder,
    cardQueries.map((query) => `${queryPrefix}${query}`),
  );

  const documentVectors = await readEmbeddings(encoder, cardDocuments);

  return Math.max(
    ...queryVectors.flatMap((queryVector, queryIndex) =>
      documentVectors.map((documentVector, documentIndex) =>
        Math.abs(
          buildCosine(queryVector, documentVector) - (cardScores[queryIndex]?.[documentIndex] ?? 0),
        ),
      ),
    ),
  );
}

async function readEmbeddings(encoder: Encoder, texts: string[]): Promise<number[][]> {
  const inputs = encoder.tokenizer(texts, {
    padding: true,
    truncation: true,
    max_length: maxTokens,
  });

  const output: unknown = await encoder.model(inputs);

  if (
    typeof output !== 'object' ||
    output === null ||
    !('sentence_embedding' in output) ||
    !(output.sentence_embedding instanceof Tensor)
  ) {
    throw new Error('the model returned no sentence_embedding tensor');
  }

  const rows: unknown = output.sentence_embedding.tolist();

  if (!isMatrix(rows)) {
    throw new Error('sentence_embedding is not a matrix of numbers');
  }

  return rows;
}

function isMatrix(value: unknown): value is number[][] {
  return (
    Array.isArray(value) &&
    value.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'number'))
  );
}

async function readSingleEmbeddings(
  encoder: Encoder,
  texts: string[],
): Promise<{ vectors: number[][]; timing: TimingSummary }> {
  const vectors: number[][] = [];
  const durationsMs: number[] = [];

  for (const text of texts) {
    const start = performance.now();

    const [vector] = await readEmbeddings(encoder, [text]);

    durationsMs.push(performance.now() - start);
    vectors.push(vector ?? []);
  }

  return { vectors, timing: buildTimingSummary(durationsMs) };
}

function formatTimingSummary(timing: TimingSummary): string {
  return (
    `median ${timing.medianMs.toFixed(1)} ms, p95 ${timing.p95Ms.toFixed(1)} ms, ` +
    `max ${timing.maxMs.toFixed(1)} ms over ${timing.count}`
  );
}

function getSubject(emailID: string): string {
  return emails.find((email) => email.id === emailID)?.subject.slice(0, 50) ?? '';
}

// The ONNX env object lists WASM keys under either backend, so the mapped native library is the
// evidence that onnxruntime-node ran.
async function readNativeOnnxLibraries(): Promise<string[] | null> {
  if (process.platform !== 'linux') {
    return null;
  }

  const maps = await Bun.file('/proc/self/maps').text();

  const libraries = maps
    .split('\n')
    .map((line) => line.split(/\s+/u).at(-1) ?? '')
    .filter((path) => /libonnxruntime|onnxruntime_binding/u.test(path))
    .map((path) => path.split('/').slice(-4).join('/'));

  return [...new Set(libraries)];
}

async function runThreadSweep(emailTexts: string[]): Promise<void> {
  for (const threads of threadCounts) {
    const encoder = await readEncoder('fp32', threads);

    await readEmbeddings(encoder, [emailTexts[0] ?? '']);

    const sweep = await readSingleEmbeddings(encoder, emailTexts);

    const label = threads === 0 ? 'runtime default' : String(threads);

    console.log(`fp32 with ${label} intra-op threads: ${formatTimingSummary(sweep.timing)}`);
  }
}
