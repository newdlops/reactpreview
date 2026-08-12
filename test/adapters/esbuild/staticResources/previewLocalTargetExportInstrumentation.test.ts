import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  instrumentPreviewLocalTargetExportBindings,
  type PreviewLocalTargetExportMetadata,
} from '../../../../src/adapters/esbuild/staticResources/previewLocalTargetExportInstrumentation';

const SOURCE_PATH = '/workspace/TaxTypeBadge.tsx';

/** Executes one generated deferred target before the Inspector API is installed. */
function evaluateDeferredTarget(initializer: string): Record<string, unknown> {
  const metadata: PreviewLocalTargetExportMetadata = {
    compilerExportEvidence: true,
    exportName: 'TaxTypeBadge',
    facadeResolutionEvidence: true,
    preparedSourceDigest: 'prepared-tax-type-badge',
    sourcePath: SOURCE_PATH,
  };
  const source = instrumentPreviewLocalTargetExportBindings(
    SOURCE_PATH,
    `export const TaxTypeBadge = ${initializer};`,
    { metadataByExport: { TaxTypeBadge: metadata }, sourcePath: SOURCE_PATH },
  );
  const context: { result?: Record<string, unknown> } = {};
  vm.runInNewContext(
    `${source.replace('export const TaxTypeBadge', 'const TaxTypeBadge')}\n` +
      'globalThis.result = TaxTypeBadge;',
    context,
  );
  if (context.result === undefined) throw new Error('Deferred target was not evaluated.');
  return context.result;
}

describe('preview local target export instrumentation', () => {
  /** styled(styled(Target)) must compose through the deferred Inspector component, not its leaf. */
  it('pins a copied styled target contract to the deferred boundary', () => {
    const target = evaluateDeferredTarget(
      `({
        componentStyle: {},
        render() {},
        styledComponentId: 'sc-tax-type-badge',
        target: function AuthoredTaxTypeBadge() {},
      })`,
    );

    expect(target.styledComponentId).toBe('sc-tax-type-badge');
    expect(target.target).toBe(target);
    expect(target.$$typeof).toBe(Symbol.for('react.forward_ref'));
  });

  /** A coincidental application `target` static is not a styled-components composition contract. */
  it('preserves an ordinary target static when no styled component id exists', () => {
    const target = evaluateDeferredTarget(`({ render() {}, target: 'application-metadata' })`);

    expect(target.target).toBe('application-metadata');
  });
});
