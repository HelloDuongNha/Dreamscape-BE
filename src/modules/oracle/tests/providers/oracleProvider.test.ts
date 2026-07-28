import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { parseOracleCredentialBody } from '../../dto/oracleCredential.dto';
import { OllamaOracleModelAdapter } from '../../services/providers/ollamaOracleProvider.service';
import { OpenAICompatibleOracleModelAdapter } from '../../services/providers/openAICompatibleOracleProvider.service';

const originalFetch = globalThis.fetch;
const originalPolicy = process.env.ORACLE_EXTERNAL_PRIVATE_CONTEXT_ACKNOWLEDGED;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalPolicy === undefined) delete process.env.ORACLE_EXTERNAL_PRIVATE_CONTEXT_ACKNOWLEDGED;
  else process.env.ORACLE_EXTERNAL_PRIVATE_CONTEXT_ACKNOWLEDGED = originalPolicy;
});

test('Ollama adapter preserves model override and the final NDJSON item', async () => {
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body || '{}'));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          '{"message":{"content":"Xin "}}\n{"message":{"content":"chào"},"prompt_eval_count":12}',
        ));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  };

  let answer = '';
  const result = await new OllamaOracleModelAdapter('http://localhost:11434', 'local-model')
    .generate(modelRequest(async (text) => { answer += text; }));

  assert.equal(requestBody.model, 'local-model');
  assert.equal(answer, 'Xin chào');
  assert.equal(result.promptTokens, 12);
});

test('OpenAI-compatible adapter preserves endpoint, key, model and token usage', async () => {
  let authorization = '';
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => {
    authorization = String(new Headers(init?.headers).get('Authorization'));
    requestBody = JSON.parse(String(init?.body || '{}'));
    return Response.json({
      choices: [{ message: { content: 'Grounded answer' } }],
      usage: { prompt_tokens: 23 },
    });
  };

  let answer = '';
  const result = await new OpenAICompatibleOracleModelAdapter(
    'https://models.example.test',
    'secret',
    'remote-model',
    true,
  ).generate(modelRequest(async (text) => { answer += text; }));

  assert.equal(authorization, 'Bearer secret');
  assert.equal(requestBody.model, 'remote-model');
  assert.equal(answer, 'Grounded answer');
  assert.equal(result.promptTokens, 23);
});

test('environment external provider requires explicit private-context acknowledgement', async () => {
  delete process.env.ORACLE_EXTERNAL_PRIVATE_CONTEXT_ACKNOWLEDGED;
  await assert.rejects(
    new OpenAICompatibleOracleModelAdapter('https://models.example.test', 'secret')
      .generate(modelRequest(async () => {})),
    /oracle_external_data_policy_not_acknowledged/u,
  );
});

test('credential DTO rejects unsupported providers before persistence', () => {
  assert.throws(
    () => parseOracleCredentialBody({ provider: 'unknown' }),
    /Unsupported model provider/u,
  );
  assert.equal(parseOracleCredentialBody({
    provider: 'ollama',
    privateContextAcknowledged: true,
  }).provider, 'ollama');
});

function modelRequest(onText: (text: string) => Promise<void>) {
  return {
    messages: [{ role: 'user' as const, content: 'Hello' }],
    model: 'default-model',
    contextWindow: 4096,
    maxOutputTokens: 512,
    signal: new AbortController().signal,
    onText,
  };
}
