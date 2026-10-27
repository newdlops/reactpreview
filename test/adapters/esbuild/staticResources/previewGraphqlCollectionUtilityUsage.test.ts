/** Reproduces object-shaped fragment lists consumed by real ordering iteratees. */
import { describe, expect, it } from 'vitest';
import { createPreviewGraphqlFragmentValueReplacements } from '../../../../src/adapters/esbuild/staticResources/previewGraphqlFragmentValueInstrumentation';
import {
  createMetadata,
  createRuntimeFallbackFixture,
} from '../pageInspector/support/previewInspectorRuntimeFallbackFixture';

/** Reads the compiler-owned JSON contract without evaluating authored imports or expressions. */
function readRequirements(
  imports: string,
  expression: string,
  parameters = '',
  readLength = true,
): string[] {
  const source = [
    `import { getFragmentData } from './graphql/fragment-masking';`,
    imports,
    `export function Certificates(${parameters}) {`,
    '  const company = getFragmentData(DOCUMENT, carrier);',
    readLength ? '  const multiple = company.ceo.length >= 2;' : '',
    `  return ${expression};`,
    '}',
  ].join('\n');
  const replacement = createPreviewGraphqlFragmentValueReplacements(
    '/workspace/Certificates.ts',
    source,
  )[0];
  if (replacement === undefined) throw new Error('The fragment fixture was not instrumented.');
  const metadataStart = replacement.replacement.lastIndexOf('{"column":');
  return (
    JSON.parse(replacement.replacement.slice(metadataStart, -1)) as { requiredPaths: string[] }
  ).requiredPaths;
}

describe('GraphQL fragment ordering utility item demand', () => {
  it.each([
    [`import _ from 'lodash';`, '_.orderBy(company.ceo, ceo => ceo.id)'],
    [`import { default as _ } from 'lodash';`, '_.orderBy(company.ceo, ceo => ceo.id)'],
    [`import * as utility from 'lodash-es';`, 'utility.sortBy(company.ceo, ceo => ceo.id)'],
    [`import { orderBy as arrange } from 'lodash';`, 'arrange(company.ceo, ceo => ceo.id)'],
    [`import arrange from 'lodash/orderBy';`, 'arrange(company.ceo, ceo => ceo.id)'],
    [`import arrange from 'lodash-es/sortBy.js';`, 'arrange(company.ceo, ceo => ceo.id)'],
  ])('retains item evidence from %s', (imports, expression) => {
    expect(readRequirements(imports, expression)).toContain('ceo[].id');
  });

  /** GraphQL names such as `ceo` are not plural, so selection syntax alone cannot prove a list. */
  it('materializes a list before the ordering iteratee reads its item identity', () => {
    const requiredPaths = readRequirements(
      `import _ from 'lodash';`,
      '_.orderBy(company.ceo, ceo => ceo.id)',
    );
    const fixture = createRuntimeFallbackFixture(true);
    const field = (value: string, selection?: string[]): Record<string, unknown> => ({
      kind: 'Field',
      name: { value },
      ...(selection === undefined
        ? {}
        : {
            selectionSet: {
              selections: selection.map((name) => ({ kind: 'Field', name: { value: name } })),
            },
          }),
    });
    const result = fixture.api.resolveFragment(
      () => undefined,
      () => ({
        definitions: [
          {
            kind: 'FragmentDefinition',
            name: { value: 'CertificateCompany' },
            selectionSet: { selections: [field('ceo', ['id'])] },
          },
        ],
      }),
      () => Object.freeze({}),
      { ...createMetadata(), hookName: 'getFragmentData', requiredPaths },
    ) as { ceo: { id: string }[] };
    expect(Array.isArray(result.ceo)).toBe(true);
    expect(result.ceo.length).toBeGreaterThan(0);
    expect(result.ceo.map((ceo) => ceo.id)).toEqual(['preview-1']);
  });

  it('retains nested and destructured item paths from bounded literal iteratees', () => {
    const requiredPaths = readRequirements(
      `import { orderBy } from 'lodash';`,
      'orderBy(company.ceo, [({ id }) => id, ceo => ceo.latestTerm.directorType])',
    );
    expect(requiredPaths).toEqual(
      expect.arrayContaining(['ceo[].id', 'ceo[].latestTerm.directorType']),
    );
  });

  it.each([
    [`import _ from './ordering';`, '_.orderBy(company.ceo, ceo => ceo.id)', ''],
    [`import type _ from 'lodash';`, '_.orderBy(company.ceo, ceo => ceo.id)', ''],
    [`import { type orderBy } from 'lodash';`, 'orderBy(company.ceo, ceo => ceo.id)', ''],
    ['', 'orderBy(company.ceo, ceo => ceo.id)', ''],
    [`import _ from 'lodash';`, '_.orderBy(company.ceo, ceo => ceo.id)', '_'],
    [`import _ from 'lodash';`, '_.orderBy(company.ceo, ceo => ceo.id)', '{ _ }'],
    [`import _ from 'lodash';`, '_.orderBy?.(company.ceo, ceo => ceo.id)', ''],
    [`import _ from 'lodash';`, '_["orderBy"](company.ceo, ceo => ceo.id)', ''],
    [`import _ from 'lodash';`, '_.orderBy(company.ceo, externalIteratee)', ''],
    [`import _ from 'lodash';`, '_.orderBy(company.ceo, [...externalIteratees])', ''],
  ])(
    'keeps unproven collection utility calls opaque: %s %s %s',
    (imports, expression, parameters) => {
      expect(readRequirements(imports, expression, parameters)).not.toContain('ceo[].id');
    },
  );
  it('does not turn ordered object values into a list without separate length evidence', () => {
    expect(
      readRequirements(
        `import _ from 'lodash';`,
        '_.orderBy(company.ceo, ceo => ceo.id)',
        '',
        false,
      ),
    ).not.toContain('ceo[].id');
  });

  it('bounds literal iteratees without admitting part of an oversized contract', () => {
    const expression = `_.orderBy(company.ceo, [${Array.from({ length: 9 }, () => 'ceo => ceo.id').join(', ')}])`;
    expect(readRequirements(`import _ from 'lodash';`, expression)).not.toContain('ceo[].id');
  });
});
