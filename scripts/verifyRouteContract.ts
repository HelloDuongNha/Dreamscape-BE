import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

type RouteBaseline = {
  count: number;
  sha256: string;
};

const ROUTES_DIRECTORY = join(process.cwd(), 'src', 'routes');
const EXPECTED_ROUTE_FILES: Record<string, RouteBaseline> = {
  'authRoutes.ts': { count: 20, sha256: 'd003644fc47505a8aa820d2f14f90d53c7760bb2609253f785684a92b2d8373e' },
  'commentRoutes.ts': { count: 3, sha256: '1c889bf2d7f88b15a35cd23f6547a08cc26662fbee069316ead333b6acfd02d6' },
  'conversationRoutes.ts': { count: 7, sha256: '6235862702506b6f64c1bfa911852b6e32fc54315860e4b76a8826a332ed3a53' },
  'dreamRoutes.ts': { count: 18, sha256: '1fe932acffadb35d934aa84ecc75d86948d3a8a7c759af2ac86a861ccae2061b' },
  'moderationRoutes.ts': { count: 28, sha256: 'c219812d6d50179499d7e5e9950a414593a26eeb9959df96d9823f46964d8140' },
  'notificationRoutes.ts': { count: 4, sha256: '1091179e9e7b2cd3fc0407011bb2f6e137ce888eb9a4409c34e8992235365efd' },
  'oracleRoutes.ts': { count: 17, sha256: 'b7ac24a837be4ece918a24628bbbd95a0fde9a0209f2e9ee6a82d1ce9eecdae9' },
  'sourceRoutes.ts': { count: 15, sha256: '8486a14b715671f51dfa3af0814304d9f3339bc253564f2fb77e7c05e75f957e' },
  'userRoutes.ts': { count: 5, sha256: '17ae6309a7542493fabdd9bce6a16690b39991c30d2e68507890c2d15b3c72f4' },
};
const EXPECTED_MOUNT_COUNT = 9;
const EXPECTED_MOUNT_HASH = '2aaaa1c81edefe2ca6d10718399b51b3bb2a3f5b81d6321cc4a62a834fa30569';
const EXPECTED_FEATURE_ROUTE_COUNT = 117;

function sha256(lines: string[]): string {
  return createHash('sha256').update([...lines].sort().join('\n')).digest('hex');
}

function extractRouteSignatures(source: string): string[] {
  const routePattern = /router\.(get|post|put|patch|delete)\(\s*(['"])([^'"]+)\2\s*,\s*([^;]+?)\);/gs;
  return [...source.matchAll(routePattern)].map(match => (
    `${match[1].toUpperCase()} ${match[3]} :: ${match[4].replace(/\s+/g, ' ').trim()}`
  ));
}

function extractMountSignatures(source: string): string[] {
  const mountPattern = /router\.use\(\s*(['"])([^'"]+)\1\s*,\s*([A-Za-z0-9_]+)\s*\);/g;
  return [...source.matchAll(mountPattern)].map(match => `${match[2]} :: ${match[3]}`);
}

function fail(message: string): never {
  throw new Error(`[route-contract] ${message}`);
}

function verifyRouteFiles(): number {
  const actualRouteFiles = readdirSync(ROUTES_DIRECTORY)
    .filter(file => file.endsWith('Routes.ts'))
    .sort();
  const expectedRouteFiles = Object.keys(EXPECTED_ROUTE_FILES).sort();
  if (JSON.stringify(actualRouteFiles) !== JSON.stringify(expectedRouteFiles)) {
    fail(`Route files changed.\nExpected: ${expectedRouteFiles.join(', ')}\nActual: ${actualRouteFiles.join(', ')}`);
  }

  let total = 0;
  for (const file of expectedRouteFiles) {
    const signatures = extractRouteSignatures(readFileSync(join(ROUTES_DIRECTORY, file), 'utf8'));
    const baseline = EXPECTED_ROUTE_FILES[file];
    total += signatures.length;
    if (signatures.length !== baseline.count) {
      fail(`${file} has ${signatures.length} routes; expected ${baseline.count}.`);
    }
    const actualHash = sha256(signatures);
    if (actualHash !== baseline.sha256) {
      fail(`${file} changed method, path, middleware order, or handler binding.`);
    }
    console.log(`✓ ${file}: ${signatures.length} route contracts unchanged`);
  }
  return total;
}

function verifyCompositionRoot(): void {
  const indexSource = readFileSync(join(ROUTES_DIRECTORY, 'index.ts'), 'utf8');
  const mounts = extractMountSignatures(indexSource);
  if (mounts.length !== EXPECTED_MOUNT_COUNT || sha256(mounts) !== EXPECTED_MOUNT_HASH) {
    fail('src/routes/index.ts changed a mount path or mounted router.');
  }
  if (!/router\.get\(\s*['"]\/health['"]/u.test(indexSource)) {
    fail('Health endpoint /health is missing.');
  }
  console.log(`✓ index.ts: health endpoint and ${mounts.length} router mounts unchanged`);
}

const featureRouteCount = verifyRouteFiles();
if (featureRouteCount !== EXPECTED_FEATURE_ROUTE_COUNT) {
  fail(`Expected ${EXPECTED_FEATURE_ROUTE_COUNT} feature routes, found ${featureRouteCount}.`);
}
verifyCompositionRoot();
console.log(`ROUTE CONTRACT: ${featureRouteCount} feature routes + 1 health route preserved`);
