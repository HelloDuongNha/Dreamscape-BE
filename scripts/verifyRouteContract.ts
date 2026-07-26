import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

type RouteBaseline = {
  count: number;
  sha256: string;
};

const ROUTES_DIRECTORY = join(process.cwd(), 'src', 'routes');
const EXPECTED_ROUTE_FILES: Record<string, RouteBaseline> = {
  'authRoutes.ts': { count: 10, sha256: '98f79ffaaf3d0432311a2c1d68aea8a08c699a0fda5382e537e12e09f5601be5' },
  'commentRoutes.ts': { count: 1, sha256: 'f825129e8d6c96eff3f3a20eee76fe2a7844276f5fd869e0706e40d8d3226807' },
  'conversationRoutes.ts': { count: 4, sha256: '4a9fecdf6c5ab6dbf4d80cba802df0a888d4bf9256f2dd7c65a7e385be773c5c' },
  'dreamRoutes.ts': { count: 16, sha256: 'ac86cd2b18566c69516aa59ff35c05293d8c9ef634e8a34d9a23f1dcf7975a72' },
  'moderationRoutes.ts': { count: 29, sha256: '97871a269928fd2d20138d6cfec6cf5c9437df786668e43320cc529864678093' },
  'notificationRoutes.ts': { count: 2, sha256: '06f0f3e29d332edffdfe74a44d81e0eb706c4b9c4543e099a14706517c0bc632' },
  'oracleRoutes.ts': { count: 17, sha256: 'b7ac24a837be4ece918a24628bbbd95a0fde9a0209f2e9ee6a82d1ce9eecdae9' },
  'sourceRoutes.ts': { count: 15, sha256: '2ebe795dda53bea9545836503d20a7f3d1b71fa2005dd2cde44d730994d71546' },
  'userRoutes.ts': { count: 4, sha256: 'f3db1e5dff80c3ae80f150d0d464d2de96965091ad040cd3909251c07c54f8ec' },
};
const EXPECTED_MOUNT_COUNT = 9;
const EXPECTED_MOUNT_HASH = '2aaaa1c81edefe2ca6d10718399b51b3bb2a3f5b81d6321cc4a62a834fa30569';
const EXPECTED_FEATURE_ROUTE_COUNT = 98;

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
