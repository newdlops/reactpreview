/** Exercises the generated GraphQL recovery runtime without mounting React or GraphQL packages. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorGraphqlDocumentRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorGraphqlDocumentRuntimeSource';

/** Minimal generated runtime surface exposed by the isolated VM fixture. */
interface GraphqlRuntimeFixture {
  readonly autoDecisions: Record<string, unknown>[];
  readonly consoleEntries: Record<string, unknown>[];
  readonly healthEvents: Record<string, unknown>[];
  readonly resolve: (
    readValue: () => unknown,
    fallbackSource: string,
    metadata: Record<string, unknown>,
  ) => unknown;
  readonly setAuto: (enabled: boolean) => void;
  readonly status: () => string;
}

const fallbackSource = 'fragment CompanyFields on Company { name }';
const metadata = {
  bindingName: 'COMPANY_FIELDS',
  column: 5,
  fragmentNames: ['CompanyFields'],
  fragmentSourcePath: '/workspace/company-fragment.ts',
  id: 'graphql:company-fields',
  line: 8,
  sourcePath: '/workspace/query.ts',
};

describe('Preview Inspector GraphQL document runtime source', () => {
  /** Returns a real initialized DocumentNode without recording a compatibility action. */
  it('preserves an initialized fragment value', () => {
    const runtime = createRuntime();
    const documentNode = { definitions: [], kind: 'Document' };

    expect(runtime.resolve(() => documentNode, fallbackSource, metadata)).toBe(documentNode);
    expect(runtime.autoDecisions).toHaveLength(0);
    expect(runtime.healthEvents).toHaveLength(0);
  });

  /** Substitutes exact static source and records an independent causal Auto decision once. */
  it('repairs and logs a nullish circular interpolation', () => {
    const runtime = createRuntime();

    expect(runtime.resolve(() => undefined, fallbackSource, metadata)).toBe(fallbackSource);
    expect(runtime.resolve(() => undefined, fallbackSource, metadata)).toBe(fallbackSource);

    expect(runtime.autoDecisions).toHaveLength(1);
    expect(runtime.autoDecisions[0]).toMatchObject({
      blockerKind: 'graphql-document',
      blockerName: 'Circular GraphQL fragment · CompanyFields',
    });
    expect(runtime.healthEvents).toHaveLength(1);
    expect(runtime.healthEvents[0]).toMatchObject({
      category: 'module-initialization',
      event: 'graphql-interpolation-repaired',
    });
    expect(runtime.consoleEntries).toHaveLength(1);
    expect(runtime.status()).toContain('active: 1');
  });

  /** Restores the authored TDZ exception when the user disables generated Auto values. */
  it('rethrows the original binding failure when Auto values are disabled', () => {
    const runtime = createRuntime();
    runtime.setAuto(false);

    expect(() =>
      runtime.resolve(
        () => {
          throw new ReferenceError('Cannot access before initialization');
        },
        fallbackSource,
        metadata,
      ),
    ).toThrow('Cannot access before initialization');
    expect(runtime.autoDecisions).toHaveLength(0);
  });
});

/** Evaluates generated source with inert logging, policy, and session primitives. */
function createRuntime(): GraphqlRuntimeFixture {
  const context: { __runtime?: GraphqlRuntimeFixture } = {};
  vm.runInNewContext(
    `
      let autoEnabled = true;
      const previewInspectorSession = {};
      const autoDecisions = [];
      const consoleEntries = [];
      const healthEvents = [];
      const createRuntimeErrorHeadline = (error) => String(error?.name || 'Error') + ': ' + String(error?.message || error);
      const readPreviewInspectorFallbackValuesEnabled = () => autoEnabled;
      const recordPreviewInspectorBlockerAutoDecision = (entry) => autoDecisions.push(entry);
      const recordPreviewInspectorConsoleEntry = (entry) => consoleEntries.push(entry);
      const recordPreviewInspectorRuntimeHealth = (entry) => healthEvents.push(entry);
      const readPreviewInspectorConsolePrimitives = () => ({ warn() {} });
      ${createPreviewInspectorGraphqlDocumentRuntimeSource()}
      globalThis.__runtime = {
        autoDecisions,
        consoleEntries,
        healthEvents,
        resolve: resolvePreviewInspectorGraphqlInterpolation,
        setAuto(enabled) { autoEnabled = enabled; },
        status: readPreviewInspectorGraphqlDocumentStatus,
      };
    `,
    context,
  );
  if (context.__runtime === undefined)
    throw new Error('GraphQL runtime fixture did not initialize.');
  return context.__runtime;
}
