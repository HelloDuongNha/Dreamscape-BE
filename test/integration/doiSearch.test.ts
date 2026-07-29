import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before, beforeEach } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import app from '../../src/app';
import AcademicSource from '../../src/modules/academic/models/AcademicSource';
import User from '../../src/modules/identity/models/User';
import { parseApprovedSourceCatalogQuery } from '../../src/modules/academic/dto/approvedSource.dto';
import { connectTestDatabase, disconnectTestDatabase } from '../support/testDatabase';

const databaseConfigured = Boolean(process.env.MONGODB_TEST_URI);
if (databaseConfigured) {
  const databaseUri = new URL(process.env.MONGODB_TEST_URI!);
  databaseUri.pathname = '/dreamscape_doi_search_test';
  process.env.MONGODB_TEST_URI = databaseUri.toString();
}

let server: http.Server;
let baseUrl = '';

before(async () => {
  if (!databaseConfigured) return;
  process.env.JWT_SECRET = 'doi-search-integration-secret';
  await connectTestDatabase();
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a port.');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  if (!databaseConfigured) return;
  await Promise.all([AcademicSource.deleteMany({}), User.deleteMany({})]);
});

after(async () => {
  if (!databaseConfigured) return;
  await Promise.all([AcademicSource.deleteMany({}), User.deleteMany({})]);
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  await disconnectTestDatabase();
});

test('DOI search normalization treats plain, prefixed and doi.org forms as one identifier', () => {
  const expected = '10.1371/journal.pone.0264574';
  for (const input of [
    expected,
    `doi: ${expected.toUpperCase()}`,
    `https://doi.org/${expected}`,
  ]) {
    const parsed = parseApprovedSourceCatalogQuery({ doi: input });
    assert.equal(parsed.doi, expected);
    assert.equal(parsed.validationError, null);
  }

  const invalid = parseApprovedSourceCatalogQuery({ doi: 'not-a-doi' });
  assert.equal(invalid.doi, null);
  assert.equal(invalid.validationError, 'invalid_doi');
});

test('approved catalog resolves an exact canonical DOI without creating a source', { skip: !databaseConfigured }, async () => {
  const sessionId = new mongoose.Types.ObjectId();
  const user = await User.create({
    username: '@doi_search_user',
    display_name: 'DOI search user',
    email: 'doi-search@example.test',
    password: 'CurrentPass9',
    sessions: [{ _id: sessionId, lastActive: new Date(), authenticatedAt: new Date() }],
  });
  const doi = '10.1371/journal.pone.0264574';
  await AcademicSource.create({
    sourceContributionId: new mongoose.Types.ObjectId(),
    title: 'Constructive episodic simulation in dreams',
    doi,
    normalizedDoi: doi,
  });
  const token = jwt.sign(
    { id: String(user._id), sessionId: String(sessionId) },
    process.env.JWT_SECRET!,
    { expiresIn: '5m' },
  );

  const beforeCount = await AcademicSource.countDocuments({});
  const response = await fetch(
    `${baseUrl}/api/sources/approved?doi=${encodeURIComponent(`https://doi.org/${doi}`)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = await response.json() as any;

  assert.equal(response.status, 200);
  assert.equal(body.data.items.length, 1);
  assert.equal(body.data.items[0].doi, doi);
  assert.equal(await AcademicSource.countDocuments({}), beforeCount);

  const invalidResponse = await fetch(
    `${baseUrl}/api/sources/approved?doi=not-a-doi`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  assert.equal(invalidResponse.status, 400);
  assert.equal((await invalidResponse.json() as any).code, 'invalid_doi');
  assert.equal(await AcademicSource.countDocuments({}), beforeCount);
});
