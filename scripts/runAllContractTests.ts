import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const EXPECTED_BASELINE_TEST_COUNT = 26;
const sourceRoot = join(process.cwd(), 'src');

function collectTests(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory()
        ? collectTests(path)
        : path.endsWith('.test.ts') ? [path] : [];
    })
    .sort();
}

const testFiles = collectTests(sourceRoot);
if (testFiles.length !== EXPECTED_BASELINE_TEST_COUNT) {
  throw new Error(
    `[contract-tests] Expected ${EXPECTED_BASELINE_TEST_COUNT} test files, found ${testFiles.length}. `
    + 'Tests must be moved with their module, not silently deleted.',
  );
}

for (const testFile of testFiles) {
  const relativePath = testFile.slice(process.cwd().length + 1);
  console.log(`\n▶ ${relativePath}`);
  const result = spawnSync(process.execPath, ['--import', 'tsx', testFile], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log(`\nCONTRACT TEST BASELINE: ${testFiles.length}/${EXPECTED_BASELINE_TEST_COUNT} files passed`);

