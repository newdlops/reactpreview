/** Exercises bounded required-prop defaults without resolving or executing application modules. */
import { describe, expect, it } from 'vitest';
import {
  createReactExportPropFallbackReplacements,
  type ReactExportPropFallbackReplacement,
} from '../../../../src/adapters/esbuild/staticResources/reactExportPropFallback';

describe('createReactExportPropFallbackReplacements', () => {
  /** Uses a real record key when a required domain prop indexes that record before rendering. */
  it('defaults a required indexed prop to the first module record key', () => {
    const source = [
      "import { pageNamePathMap } from './pages-map';",
      "import type { PageName } from './pages-map';",
      'export const Breadcrumb = ({ pageName }: { pageName: PageName }) => {',
      '  const pagePath = pageNamePathMap[pageName];',
      "  return <span>{pagePath.split('/')}</span>;",
      '};',
    ].join('\n');

    const replacements = createReactExportPropFallbackReplacements(
      '/workspace/Breadcrumb.tsx',
      source,
    );
    const rewritten = applyReplacements(source, replacements);

    expect(replacements).toMatchObject([
      { propName: 'pageName', replacement: ' = Object.keys(pageNamePathMap)[0]' },
    ]);
    expect(rewritten).toContain(
      '({ pageName = Object.keys(pageNamePathMap)[0] }: { pageName: PageName })',
    );
  });

  /** Prefers a same-type literal candidate over an arbitrary key from a larger runtime record. */
  it('uses a typed top-level literal candidate before indexed record evidence', () => {
    const source = [
      "import { pageNamePathMap } from './pages-map';",
      "import type { PageName } from './pages-map';",
      "const SUPPORTED_PAGES: PageName[] = ['EmployeePage', 'DashboardPage'];",
      'export const Breadcrumb = ({ pageName }: { pageName: PageName }) => {',
      '  const pagePath = pageNamePathMap[pageName];',
      "  return <span>{pagePath.split('/')}</span>;",
      '};',
    ].join('\n');

    const replacements = createReactExportPropFallbackReplacements(
      '/workspace/Breadcrumb.tsx',
      source,
    );

    expect(replacements).toMatchObject([
      { propName: 'pageName', replacement: ' = "EmployeePage"' },
    ]);
  });

  /** Fills only required syntax-resolvable primitives and preserves existing JavaScript defaults. */
  it('creates neutral values for required local props without changing optional or defaulted props', () => {
    const source = [
      'interface PreviewProps {',
      '  label: string;',
      '  count: number;',
      '  ready: boolean;',
      '  preset: string;',
      '  optional?: string;',
      '}',
      "const Card = ({ label, count, ready, optional, preset = 'kept' }: PreviewProps) => null;",
      'export { Card };',
    ].join('\n');

    const replacements = createReactExportPropFallbackReplacements('/workspace/Card.tsx', source);
    const rewritten = applyReplacements(source, replacements);

    expect(replacements.map(({ propName }) => propName)).toEqual(['label', 'count', 'ready']);
    expect(rewritten).toContain("label = ''");
    expect(rewritten).toContain('count = 0');
    expect(rewritten).toContain('ready = false');
    expect(rewritten).toContain('optional,');
    expect(rewritten).toContain("preset = 'kept'");
  });

  /** Keeps imported opaque types, non-exported helpers, JavaScript, and unsafe prop names untouched. */
  it('fails closed when no bounded default can be proven', () => {
    const typedSource = [
      "import type { RemoteValue } from './remote';",
      'const Hidden = ({ value }: { value: string }) => value;',
      'export const Visible = ({ value, ref }: { value: RemoteValue; ref: string }) => value;',
    ].join('\n');
    const javascriptSource = 'export const Visible = ({ value }) => value.split("/");';

    expect(
      createReactExportPropFallbackReplacements('/workspace/Visible.tsx', typedSource),
    ).toEqual([]);
    expect(
      createReactExportPropFallbackReplacements('/workspace/Visible.jsx', javascriptSource),
    ).toEqual([]);
  });

  /** Does not use an indexed record referenced only inside a callback with another lexical scope. */
  it('ignores nested function evidence when choosing a parameter initializer', () => {
    const source = [
      "import { values } from './values';",
      'export function Card({ name }: { name: ImportedName }) {',
      '  const readLater = () => values[name];',
      '  return <button onClick={readLater}>Open</button>;',
      '}',
      "import type { ImportedName } from './values';",
    ].join('\n');

    expect(createReactExportPropFallbackReplacements('/workspace/Card.tsx', source)).toEqual([]);
  });
});

/** Applies insertion and replacement ranges using the production transformer's offset semantics. */
function applyReplacements(
  source: string,
  replacements: readonly ReactExportPropFallbackReplacement[],
): string {
  return [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, replacement) =>
        `${result.slice(0, replacement.start)}${replacement.replacement}${result.slice(replacement.end)}`,
      source,
    );
}
