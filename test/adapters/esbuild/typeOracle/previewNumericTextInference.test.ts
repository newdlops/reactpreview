/** Numeric string samples follow actual Number consumers of the exact declared property. */
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { PreviewTypeOracle } from '../../../../src/adapters/esbuild/typeOracle/previewTypeOracle';

const SOURCE_PATH = '/virtual/preview-numeric-text.ts';
const HEADER = `
interface TypedDocumentNode<Result> { __apiType?: () => Result }
type Result = {
  metrics: { elapsedTime: string; pages: string; id: string; seenAt: string; state: 'first' | 'last' };
  untouched: { elapsedTime: string; pages: string };
};
declare const DOCUMENT: TypedDocumentNode<Result>;
export const QUERY = DOCUMENT;
declare function readData(): Result;
`;

describe('source-proven numeric string payloads', () => {
  it('reads admitted GraphQL text from this program and avoids reading excluded files', () => {
    const other = '/virtual/preview-other-document.ts';
    const outside = '/virtual/preview-unadmitted-document.ts';
    const sources = new Map([
      [SOURCE_PATH, HEADER],
      [other, `${HEADER} export const Page = () => Number(readData().metrics.pages);`],
    ]);
    const readSnapshot = vi.fn((sourcePath: string) => sources.get(sourcePath));
    const readDisk = vi.spyOn(ts.sys, 'readFile');
    const view = createOracle().createView({
      rootPaths: [SOURCE_PATH, other],
      managedNodeModulesPaths: [],
      readSnapshot,
    });
    try {
      expect(view.readTypedDocumentShapes(SOURCE_PATH).length).toBeGreaterThan(0);
      readSnapshot.mockClear();
      const shapes = view.readTypedDocumentShapes(other);
      expect(JSON.stringify(shapes)).toContain('"numeric":true');
      expect(view.readTypedDocumentShapes(outside)).toEqual([]);
      expect(readSnapshot).not.toHaveBeenCalled();
      expect(readDisk.mock.calls.filter(([file]) => file === outside)).toEqual([]);
    } finally {
      view.release();
      readDisk.mockRestore();
    }
  });

  it('follows renamed destructuring, const aliases, and literal element access', () => {
    const shape = readShape(`${HEADER}
      export function Page() {
        const data = readData();
        const { metrics: stats } = data;
        const { elapsedTime: seconds, pages, state } = stats;
        const alias = pages;
        return [Number(seconds), Number(alias), Number(stats['id']), Number(state)];
      }
    `);
    expect(shape).toMatchObject({
      fields: {
        metrics: {
          fields: {
            elapsedTime: { kind: 'string', numeric: true },
            pages: { kind: 'string', numeric: true },
            id: { kind: 'string', numeric: true },
            seenAt: { kind: 'literal', value: '2026-01-15T09:00:00.000Z' },
            state: { kind: 'literal', value: 'first' },
          },
        },
        untouched: { fields: { pages: { kind: 'string' } } },
      },
    });
    expect(JSON.stringify(shape)).toContain('"numeric":true');
    const untouched = (shape as { fields: { untouched: unknown } }).fields.untouched;
    expect(JSON.stringify(untouched)).not.toContain('numeric');
  });

  it('does not treat a locally shadowed Number as a numeric conversion', () => {
    expect(
      readShape(`${HEADER}
      export function Page(Number: (value: string) => string) {
        return Number(readData().metrics.pages);
      }
    `),
    ).toMatchObject({ fields: { metrics: { fields: { pages: { kind: 'string' } } } } });
    expect(
      JSON.stringify(
        readShape(`${HEADER}
      const Number = (value: string) => value;
      export const Page = () => Number(readData().metrics.pages);
    `),
      ),
    ).not.toContain('numeric');
  });

  it('keeps documented dates and properties with only mutable/defaulted aliases unchanged', () => {
    const shape = readShape(`
      interface TypedDocumentNode<Result> { __apiType?: () => Result }
      type Result = {
        /** YYYY-MM-DD */
        day: string;
        count: string;
        other: string;
      };
      declare const DOCUMENT: TypedDocumentNode<Result>;
      export const QUERY = DOCUMENT;
      declare function readData(): Result;
      export function Page() {
        const data = readData();
        let count = data.count;
        const { other = 'fallback' } = data;
        return [Number(data.day), Number(count), Number(other)];
      }
    `);
    expect(shape).toMatchObject({ fields: { day: { kind: 'literal', value: '2026-01-15' } } });
    expect(JSON.stringify(shape)).not.toContain('numeric');
  });

  it('recomputes evidence when an editor snapshot changes or is discarded', () => {
    const oracle = createOracle();
    const original = `${HEADER} export const Page = () => readData().metrics.pages;`;
    const changed = `${HEADER} export const Page = () => Number(readData().metrics.pages);`;
    expect(JSON.stringify(readShape(original, oracle))).not.toContain('numeric');
    expect(JSON.stringify(readShape(changed, oracle))).toContain('"numeric":true');
    expect(JSON.stringify(readShape(original, oracle))).not.toContain('numeric');
  });
});

/** Uses the production type oracle and real TypeScript libraries with an isolated editor buffer. */
function readShape(source: string, oracle = createOracle()): unknown {
  const view = oracle.createView({
    managedNodeModulesPaths: [],
    readSnapshot: (sourcePath) => (sourcePath === SOURCE_PATH ? source : undefined),
    rootPaths: [SOURCE_PATH],
  });
  const shape = view
    .readTypedDocumentShapes(SOURCE_PATH)
    .find((item) => item.identifier === 'QUERY')?.shape;
  view.release();
  expect(shape).toBeDefined();
  return shape;
}

/** A deterministic roomy heap makes tests independent of concurrently running test workers. */
function createOracle(): PreviewTypeOracle {
  return new PreviewTypeOracle(undefined, () => ({
    heap_size_limit: 4096 * 1024 * 1024,
    used_heap_size: 64 * 1024 * 1024,
  }));
}
