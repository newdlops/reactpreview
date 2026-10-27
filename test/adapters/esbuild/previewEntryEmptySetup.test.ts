/** Distinguishes a compiler-owned empty module namespace from an unsafe project configuration. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  createPreviewEntry,
  type PreviewEntrySetupKind,
} from '../../../src/adapters/esbuild/createPreviewEntry';

describe('empty setup StyleSheetManager contract', () => {
  it('does not reject an empty compiler bridge because of its generated namespace accessor', () => {
    const setupBridge = Object.defineProperty({}, 'default', {
      get: () => {
        throw new Error('The compiler already proved that no setup exists');
      },
    });
    expect(readGeneratedConfiguration('none', setupBridge)).toEqual({ status: 'absent' });
  });

  it('continues to reject project-owned setup accessors without invoking them', () => {
    const setupBridge = Object.defineProperty({}, 'styledComponentsPreview', {
      get: () => {
        throw new Error('Project accessor must stay inert');
      },
    });
    expect(readGeneratedConfiguration('custom', setupBridge)).toEqual({ status: 'unsafe' });
  });
});

/** Runs the actual generated declaration and data reader without importing project code. */
function readGeneratedConfiguration(
  setupKind: PreviewEntrySetupKind,
  setupBridge: object,
): unknown {
  const entry = createPreviewEntry({ documentName: 'Page.tsx', globalNamespaces: [], setupKind });
  const readerStart = entry.indexOf('function readSetupDataMember(');
  const readerEnd = entry.indexOf('/** Produces serializable component props', readerStart);
  const declarationStart = entry.indexOf('const styledComponentsSetup =');
  const declarationEnd = entry.indexOf('const setupModule =', declarationStart);
  return vm.runInNewContext(
    `${entry.slice(readerStart, readerEnd)}\n${entry.slice(declarationStart, declarationEnd)}\nstyledComponentsSetup`,
    { setupBridge },
  );
}
