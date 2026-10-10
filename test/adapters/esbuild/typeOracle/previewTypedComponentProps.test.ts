/** Verifies typed required props read from a component's declared props type. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { readPreviewTypedComponentProps } from '../../../../src/adapters/esbuild/typeOracle/previewTypedComponentProps';

const ENTRY = '/virtual/SimSheet.tsx';

/** Reads typed props of `exportName` from a virtual module checked by a real TypeScript program. */
function readTypedProps(source: string, exportName: string): unknown {
  const options: ts.CompilerOptions = {
    jsx: ts.JsxEmit.Preserve,
    lib: ['lib.es2022.d.ts'],
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host = ts.createCompilerHost(options, true);
  const readDisk = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion) =>
    fileName === ENTRY
      ? ts.createSourceFile(fileName, source, languageVersion, true, ts.ScriptKind.TSX)
      : readDisk(fileName, languageVersion);
  const program = ts.createProgram({ host, options, rootNames: [ENTRY] });
  const sourceFile = program.getSourceFile(ENTRY);
  if (sourceFile === undefined) throw new Error('The virtual module was not loaded.');
  return readPreviewTypedComponentProps(program.getTypeChecker(), sourceFile, exportName);
}

describe('readPreviewTypedComponentProps', () => {
  /** SimSheet's typed `weeks.future` gave one "W+1" header over four forecast columns. */
  it('fills declared lists with three items like generated lists', () => {
    const props = readTypedProps(
      [
        'interface SimWeeks { current: string; future: string[]; startDates: string[] }',
        'interface Props { weeks: SimWeeks; codes: string[] }',
        'export function SimSheet({ weeks, codes }: Props) { return null; }',
      ].join('\n'),
      'SimSheet',
    ) as { codes: string[]; weeks: { future: string[]; startDates: string[] } };

    expect(props.weeks.future).toHaveLength(3);
    expect(props.codes).toHaveLength(3);
    expect(props.weeks.startDates).toEqual(['2026-01-15', '2026-01-14', '2026-01-13']);
  });
});
