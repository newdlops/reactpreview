/**
 * Verifies declared-type rebinding of nullable render guards inside forced JSX branches.
 * A stub oracle isolates the rewrite policy from TypeScript program construction.
 */
import { describe, expect, it } from 'vitest';
import { StaticSourceAnalysis } from '../../../../src/adapters/esbuild/staticResources/staticCallParser';
import { applyPreviewSourceReplacements } from '../../../../src/adapters/esbuild/staticResources/previewSourceReplacement';
import { createPreviewTypedGuardReplacements } from '../../../../src/adapters/esbuild/staticResources/previewTypedGuardReplacements';
import type {
  PreviewTypedGuardRequest,
  PreviewTypeOracleView,
} from '../../../../src/adapters/esbuild/typeOracle/previewTypeOracle';

describe('createPreviewTypedGuardReplacements', () => {
  it('skips the type oracle when every guarded read is already replaced', () => {
    const source = 'export function Page({row}) { return row && <b>{row.name}</b>; }';
    const requests: PreviewTypedGuardRequest[] = [];
    const result = createPreviewTypedGuardReplacements(
      '/w/Page.tsx',
      source,
      createOracle(requests, { name: 'Name' }, true),
      () => 'guard',
      [
        {
          start: source.indexOf('row.name'),
          end: source.indexOf('row.name') + 3,
          replacement: 'knownRow',
        },
      ],
    );
    expect(result).toEqual({ declarations: [], replacements: [] });
    expect(requests).toEqual([]);
  });

  it('keeps exact source offsets and required paths when reusing a private parse', () => {
    const path = '/w/Page.tsx',
      source = 'export function Page({row}) { return row && <b>{row.name}</b>; }';
    const analysis = new StaticSourceAnalysis(path, source),
      first: PreviewTypedGuardRequest[] = [],
      next: PreviewTypedGuardRequest[] = [];
    const original = createPreviewTypedGuardReplacements(
      path,
      source,
      createOracle(first, { name: 'Name' }, true),
      () => 'guard',
      [],
    );
    const reused = createPreviewTypedGuardReplacements(
      path,
      source,
      createOracle(next, { name: 'Name' }, true),
      () => 'guard',
      [],
      analysis,
    );
    expect(reused).toEqual(original);
    expect(next).toEqual(first);
    const changed = source.replace('row.name', 'row.email'),
      requests: PreviewTypedGuardRequest[] = [];
    createPreviewTypedGuardReplacements(
      path,
      changed,
      createOracle(requests, { email: 'Email' }, true),
      () => 'guard',
      [],
      analysis,
    );
    expect(requests[0]?.requiredPaths).toEqual(['email']);
  });

  /** Reads inside the guarded branch fall back to the typed state; authored truthy state wins. */
  it('rebinds nullable guard reads inside the JSX branch', () => {
    const source = [
      'export function InboundTab() {',
      '  const [form, setForm] = useState<FormState>(null);',
      '  return <div>',
      '    {form && (',
      '      <InboundModal',
      "        existing={form.mode === 'create' ? undefined : form.rows}",
      '        onClose={() => setForm(null)}',
      '      />',
      '    )}',
      '  </div>;',
      '}',
    ].join('\n');
    const requests: PreviewTypedGuardRequest[] = [];
    const result = createPreviewTypedGuardReplacements(
      '/workspace/src/InboundTab.tsx',
      source,
      createOracle(requests, { mode: 'edit', rows: [{ id: 'preview-id' }] }, true),
      () => '__previewTypedGuard1',
      [],
    );
    const rewritten = applyPreviewSourceReplacements(source, result.replacements);

    expect(requests[0]?.requiredPaths).toEqual(['mode', 'rows']);
    expect(rewritten).toContain("existing={(form || __previewTypedGuard1).mode === 'create'");
    expect(rewritten).toContain('undefined : (form || __previewTypedGuard1).rows}');
    expect(rewritten).toContain('{form && (');
    expect(result.declarations).toEqual([
      'const __previewTypedGuard1 = Object.freeze({ "mode": "edit", "rows": Object.freeze([Object.freeze({ "id": "preview-id" })]) });',
    ]);
  });

  /** A branch that redeclares the name, or a non-nullable guard, is left untouched. */
  it('skips shadowed names and guards that cannot be null', () => {
    const shadowed = [
      'export function Rows({ rows }: Props) {',
      '  return <ul>{rows && rows.map((rows) => <li key={rows.id}>{rows.name}</li>)}</ul>;',
      '}',
    ].join('\n');
    const plain = [
      'export function Row({ row }: Props) {',
      '  return <p>{row && <span>{row.name}</span>}</p>;',
      '}',
    ].join('\n');

    expect(
      createPreviewTypedGuardReplacements(
        '/w/Rows.tsx',
        shadowed,
        createOracle([], { id: 'x' }, true),
        () => 'g',
        [],
      ),
    ).toEqual({ declarations: [], replacements: [] });
    expect(
      createPreviewTypedGuardReplacements(
        '/w/Row.tsx',
        plain,
        createOracle([], { name: 'x' }, false),
        () => 'g',
        [],
      ),
    ).toEqual({ declarations: [], replacements: [] });
  });

  /** A bypassed `if (!row) return null` keeps later reads, including closures, off `null`. */
  it('rebinds reads that follow a nullable early-return guard', () => {
    const source = [
      'export function SkuDetailModal({ row, onClose }: Props) {',
      '  if (!row) return null;',
      '  const status = STATUS[row.status];',
      '  return <aside onClick={() => onClose(row.code)}>{row.name}{status.label}</aside>;',
      '}',
    ].join('\n');
    const requests: PreviewTypedGuardRequest[] = [];
    const result = createPreviewTypedGuardReplacements(
      '/workspace/src/SkuDetailModal.tsx',
      source,
      createOracle(requests, { code: 'code', name: 'name', status: 'ok' }, true),
      () => 'rowGuard',
      [],
    );
    const rewritten = applyPreviewSourceReplacements(source, result.replacements);

    expect(requests[0]).toMatchObject({
      expressionText: '!row',
      kind: 'negation',
      requiredPaths: ['status', 'code', 'name'],
    });
    expect(rewritten).toContain('if (!row) return null;');
    expect(rewritten).toContain('STATUS[(row || rowGuard).status]');
    expect(rewritten).toContain('onClose((row || rowGuard).code)');
    expect(rewritten).toContain('{(row || rowGuard).name}');
  });

  /** Intrinsic JSX tags and attribute names that spell the guard are not value reads. */
  it('keeps JSX tag and attribute names intact', () => {
    const source = [
      'export function Editor() {',
      '  const [form, setForm] = useState<FormState | null>(null);',
      '  return <section>{form ? <form form={form.id}><input name={form.name} /></form> : null}</section>;',
      '}',
    ].join('\n');
    const result = createPreviewTypedGuardReplacements(
      '/workspace/src/Editor.tsx',
      source,
      createOracle([], { id: 'preview-id', name: 'name' }, true),
      () => 'guardValue',
      [],
    );
    const rewritten = applyPreviewSourceReplacements(source, result.replacements);

    expect(rewritten).toContain('<form form={(form || guardValue).id}>');
    expect(rewritten).toContain('<input name={(form || guardValue).name} />');
    expect(rewritten).toContain('</form>');
  });
});

/** Creates a stub oracle that answers every guard request with one typed value. */
function createOracle(
  requests: PreviewTypedGuardRequest[],
  value: Record<string, unknown>,
  nullable: boolean,
): PreviewTypeOracleView {
  return {
    readStatus: () => undefined,
    readTypedCallValue: () => undefined,
    readTypedDocumentShapes: () => [],
    readTypedCallResponseShape: () => undefined,
    readTypedComponentProps: () => undefined,
    readTypedExportValue: () => undefined,
    readTypedModuleTypeValue: () => undefined,
    readTypedResponseShape: () => undefined,
    release: () => undefined,
    readTypedGuardValue: (request) => {
      requests.push(request);
      return { literals: {}, nodes: 1, nullable, typeText: 'FormState', value: value as never };
    },
  };
}
