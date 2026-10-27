/** Exercises real Node pipe framing without replacing the separate Chromium integration checks. */
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CdpPipeClient,
  decodePreviewHeadlessCdpFrames,
} from '../../../src/adapters/node/previewHeadlessCdp';
import type { CdpMessage } from '../../../src/adapters/node/previewHeadlessModel';

/** Keeps each request, response, and teardown attached to the exact streams created by a test. */
interface PipeFixture {
  readonly client: CdpPipeClient;
  readonly input: PassThrough;
  readonly output: PassThrough;
  readonly requests: readonly CdpMessage[];
}

const disposals: (() => void)[] = [];

afterEach(async () => {
  for (const dispose of disposals.splice(0)) dispose();
  await nextTurn();
});

/** Connects actual Node streams and records outbound request IDs instead of assuming their values. */
function createPipeFixture(): PipeFixture {
  const input = new PassThrough();
  const output = new PassThrough({ autoDestroy: false });
  const requests: CdpMessage[] = [];
  let bufferedRequests = '';
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    const decoded = decodePreviewHeadlessCdpFrames(bufferedRequests + chunk);
    bufferedRequests = decoded.remainder;
    requests.push(...decoded.messages);
  });
  const client = new CdpPipeClient(input, output);
  disposals.push(() => {
    client.fail(new Error('Test-owned CDP pipe disposed.'));
    input.destroy();
    output.destroy();
  });
  return { client, input, output, requests };
}

/** Lets real readable end/error notifications settle without a browser or a wall-clock timeout. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('headless CDP byte transport', () => {
  it.each([
    { text: 'é', split: 1 },
    { text: '미리보기', split: 1 },
    { text: '미리보기', split: 2 },
    { text: '📦', split: 1 },
    { text: '📦', split: 2 },
    { text: '📦', split: 3 },
  ])(
    'preserves a response split inside UTF-8 text $text at byte $split',
    async ({ text, split }) => {
      const fixture = createPipeFixture();
      const pending = fixture.client.request('Runtime.evaluate', { expression: 'document.title' });
      const request = fixture.requests[0];
      expect(request?.method).toBe('Runtime.evaluate');
      const expected = { id: request?.id, result: { result: { type: 'string', value: text } } };
      const encoded = Buffer.from(JSON.stringify(expected) + '\0');
      const boundary = encoded.indexOf(Buffer.from(text)) + split;
      expect(boundary).toBeGreaterThan(split);
      fixture.output.write(encoded.subarray(0, boundary));
      fixture.output.write(encoded.subarray(boundary));
      expect(await pending).toEqual(expected);
    },
  );

  it('keeps multibyte events and multiple frames intact when each byte arrives separately', () => {
    const fixture = createPipeFixture();
    const observed: CdpMessage[] = [];
    fixture.client.onEvent((message) => {
      observed.push(message);
    });
    const events = [
      { method: 'Runtime.consoleAPICalled', params: { text: '한글 오류 📦' } },
      { method: 'Log.entryAdded', params: { text: 'café 미리보기' } },
    ];
    const encoded = Buffer.from(events.map((event) => JSON.stringify(event) + '\0').join(''));
    for (let index = 0; index < encoded.length; index++)
      fixture.output.write(encoded.subarray(index, index + 1));
    expect(observed).toEqual(events);
  });

  it('correlates interleaved responses and events while retaining an incomplete frame', async () => {
    const fixture = createPipeFixture();
    const events: CdpMessage[] = [];
    fixture.client.onEvent((message) => {
      events.push(message);
    });
    const first = fixture.client.request('Page.enable');
    const second = fixture.client.request('Runtime.enable');
    const firstResponse = { id: fixture.requests[0]?.id, result: { enabled: 'page' } };
    const secondResponse = { id: fixture.requests[1]?.id, result: { enabled: 'runtime' } };
    const event = { method: 'Runtime.executionContextCreated', params: { name: 'page' } };
    const source = [secondResponse, event, firstResponse]
      .map((message) => JSON.stringify(message) + '\0')
      .join('');
    fixture.output.write(Buffer.from(source.slice(0, -5)));
    expect(await second).toEqual(secondResponse);
    expect(events).toEqual([event]);
    fixture.output.write(Buffer.from(source.slice(-5)));
    expect(await first).toEqual(firstResponse);
  });

  it.each(['', '{"id":1,"result":{'])(
    'rejects pending and future requests at response EOF (%j)',
    async (partial) => {
      const fixture = createPipeFixture();
      let failure: unknown;
      void fixture.client.request('Target.getTargets').catch((error: unknown) => {
        failure = error;
      });
      fixture.output.end(Buffer.from(partial));
      await nextTurn();
      expect(fixture.output.readableEnded).toBe(true);
      expect(fixture.output.closed).toBe(false);
      expect(failure).toBeInstanceOf(Error);
      if (!(failure instanceof Error)) throw new Error('Expected immediate EOF rejection.');
      expect(failure.message).toBe('Chromium CDP response pipe ended.');
      await expect(fixture.client.request('Page.enable')).rejects.toBe(failure);
    },
  );

  it('rejects all waiting requests when a complete frame is malformed', async () => {
    const fixture = createPipeFixture();
    const first = fixture.client.request('Page.enable');
    const second = fixture.client.request('Runtime.enable');
    const settled = Promise.allSettled([first, second]);
    fixture.output.write(Buffer.from('{malformed}\0'));
    expect((await settled).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    await expect(fixture.client.request('Page.navigate')).rejects.toBeInstanceOf(SyntaxError);
  });

  it('does not deliver later browser events after the request pipe has failed', async () => {
    const fixture = createPipeFixture();
    const events: CdpMessage[] = [];
    fixture.client.onEvent((message) => {
      events.push(message);
    });
    fixture.input.destroy(new Error('fixture request pipe failed'));
    await nextTurn();
    fixture.output.write(
      Buffer.from(
        JSON.stringify({ method: 'Runtime.bindingCalled', params: { payload: 'late' } }) + '\0',
      ),
    );
    expect(events).toEqual([]);
    await expect(fixture.client.request('Page.enable')).rejects.toThrow(
      'fixture request pipe failed',
    );
  });
});
