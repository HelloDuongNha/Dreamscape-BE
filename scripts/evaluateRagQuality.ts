import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  evaluateRagCases,
  type RagEvaluationCase,
} from './lib/ragEvaluationMetrics';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const datasetPath = argumentValue(args, '--dataset')
    || path.resolve(process.cwd(), 'test/fixtures/rag-evaluation.calibration.json');
  const outputPath = argumentValue(args, '--output');
  const dataset = JSON.parse(await readFile(datasetPath, 'utf8')) as {
    datasetType?: string;
    cases?: RagEvaluationCase[];
  };
  if (!Array.isArray(dataset.cases)) {
    throw new Error('The dataset must contain a cases array.');
  }
  const summary = {
    dataset: datasetPath,
    datasetType: dataset.datasetType || 'unspecified',
    generatedAt: new Date().toISOString(),
    ...evaluateRagCases(dataset.cases),
  };
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (outputPath) await writeFile(outputPath, text, 'utf8');
  process.stdout.write(text);
  if (summary.datasetType === 'calibration') {
    process.stderr.write(
      'Calibration data checks the evaluator only. Do not report these values as DreamScape quality results.\n',
    );
  }
}

function argumentValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
