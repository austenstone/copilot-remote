import { performance } from 'node:perf_hooks';
import { markdownToHtml, markdownToTelegramChunks } from './format.js';
import { TelegramClient } from './telegram.js';

type Sample = {
  name: string;
  iterations: number;
  run: () => Promise<void> | void;
};

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx] ?? 0;
}

async function benchmark(sample: Sample) {
  const runs: number[] = [];
  for (let i = 0; i < sample.iterations; i++) {
    const started = performance.now();
    await sample.run();
    runs.push(performance.now() - started);
  }
  const total = runs.reduce((sum, ms) => sum + ms, 0);
  return {
    name: sample.name,
    iterations: sample.iterations,
    avg: total / sample.iterations,
    min: Math.min(...runs),
    p50: percentile(runs, 50),
    p95: percentile(runs, 95),
    max: Math.max(...runs),
  };
}

const shortMarkdown = [
  '# Copilot Remote',
  '',
  'Ship **fast** with _tight_ feedback loops.',
  '',
  '- `/status` for session info',
  '- `/config` for live settings',
  '',
  'See `src/index.ts` and `README.md` for more.',
].join('\n');

const longMarkdown = Array.from({ length: 120 }, (_, i) => {
  return [
    `## Step ${i + 1}`,
    '',
    `Benchmark **message** ${i + 1} with _rich_ markdown, links like https://github.com/tag-assistant/copilot-remote, and file refs such as src/index.ts.`,
    '',
    '- queued mode is sane',
    '- immediate mode is chaos',
    '- topic drafts should be fast',
    '',
    '```ts',
    `console.log('benchmark-${i + 1}');`,
    '```',
    '',
  ].join('\n');
}).join('\n');

async function main() {
  const originalFetch = globalThis.fetch;
  const client = new TelegramClient({ botToken: 'benchmark-token', allowedUsers: [] });

  globalThis.fetch = (async () => ({
    json: async () => ({ ok: true }),
  } as unknown as Response)) as typeof fetch;

  try {
    const results = await Promise.all([
      benchmark({
        name: 'markdownToHtml(short)',
        iterations: 500,
        run: () => { markdownToHtml(shortMarkdown); },
      }),
      benchmark({
        name: 'markdownToTelegramChunks(long)',
        iterations: 150,
        run: () => { markdownToTelegramChunks(longMarkdown, 4096); },
      }),
      benchmark({
        name: 'sendDraft(topic payload only)',
        iterations: 150,
        run: async () => {
          await client.sendDraft('-1001234567890', 1, longMarkdown, 77);
        },
      }),
    ]);

    console.log('Telegram performance benchmarks');
    console.table(results.map((r) => ({
      benchmark: r.name,
      iterations: r.iterations,
      avg_ms: r.avg.toFixed(3),
      min_ms: r.min.toFixed(3),
      p50_ms: r.p50.toFixed(3),
      p95_ms: r.p95.toFixed(3),
      max_ms: r.max.toFixed(3),
    })));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});