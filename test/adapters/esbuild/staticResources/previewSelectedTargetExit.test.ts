/** Verifies that an early return rendering the selected target is taken instead of bypassed. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';
import {
  createPreviewSelectedTargetOccurrences,
  readPreviewSelectedTargetNames,
  readPreviewSelectedTargetNamesForSource,
} from '../../../../src/adapters/esbuild/staticResources/previewSelectedTargetExit';
import { instrumentReactConditionalRendering } from '../../../../src/adapters/esbuild/staticResources/reactConditionalRendering';

const APP_PATH = '/workspace/src/App.tsx';
const APP_SOURCE = [
  "import { Routes, Route } from 'react-router-dom';",
  "import { useAuthStore } from './stores/authStore';",
  "import { ToastHost } from './Toast';",
  "import { LoginPage } from './pages/LoginPage';",
  "import { DashboardPage } from './pages/DashboardPage';",
  'export default function App() {',
  '  const token = useAuthStore((s) => s.token);',
  '  if (!token)',
  '    return (',
  '      <>',
  '        <ToastHost />',
  '        <Routes><Route path="*" element={<LoginPage />} /></Routes>',
  '      </>',
  '    );',
  '  return (',
  '    <main>',
  '      <ToastHost />',
  '      <Routes><Route path="/dashboard" element={<DashboardPage />} /></Routes>',
  '    </main>',
  '  );',
  '}',
].join('\n');

describe('selected target exits', () => {
  /** Reads names exactly at the compiler's child-occurrence offsets of the owner module. */
  it('reads the component rendered at a target occurrence', () => {
    const sourceFile = ts.createSourceFile(APP_PATH, APP_SOURCE, ts.ScriptTarget.Latest, true);
    const occurrence = APP_SOURCE.indexOf('<LoginPage />');

    expect([...readPreviewSelectedTargetNames(sourceFile, [occurrence])]).toEqual(['LoginPage']);
    expect(
      readPreviewSelectedTargetNamesForSource(
        createPreviewSelectedTargetOccurrences([
          { occurrenceStart: occurrence, owner: { sourcePath: APP_PATH } },
        ]),
        APP_PATH,
        APP_SOURCE,
      ),
    ).toEqual(new Set(['LoginPage']));
  });

  /** Makes the login branch the target branch of `if (!token) return …`. */
  it('takes an early return whose JSX renders the target', () => {
    const instrumented = instrumentReactConditionalRendering(
      APP_PATH,
      APP_SOURCE,
      undefined,
      new Set(['LoginPage']),
    );
    const authored = instrumentReactConditionalRendering(APP_PATH, APP_SOURCE);

    expect(instrumented).toContain('"fallbackBranch":"falsy"');
    expect(instrumented).toContain('"targetBranch":"truthy"');
    expect(instrumented).toContain('"targetBranchEvidence":"selected-target"');
    expect(authored).not.toContain('targetBranchEvidence');
    expect(authored).toContain('"fallbackBranch":"truthy"');
    expect(authored).toContain('"targetBranch":"falsy"');
  });

  /** Keeps continuing past the guard when the target also renders after it. */
  it('leaves an ambiguous component rendered on both sides unchanged', () => {
    const ambiguous = instrumentReactConditionalRendering(
      APP_PATH,
      APP_SOURCE,
      undefined,
      new Set(['ToastHost']),
    );

    expect(ambiguous).toBe(instrumentReactConditionalRendering(APP_PATH, APP_SOURCE));
  });

  /** Stops generating a truthy store value that would skip the login branch. */
  it('does not generate a value that continues past the target exit', () => {
    const authored = applyReplacements(
      APP_SOURCE,
      createPreviewRuntimeHookReplacements(APP_PATH, APP_SOURCE),
    );
    const targeted = applyReplacements(
      APP_SOURCE,
      createPreviewRuntimeHookReplacements(
        APP_PATH,
        APP_SOURCE,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        new Set(['LoginPage']),
      ),
    );

    expect(authored).toContain('generated Boolean true to continue past an early return');
    expect(targeted).not.toContain('to continue past an early return');
    expect(targeted).toContain(
      'generated Boolean false to take the branch rendering the selected target',
    );
  });
});

/** Applies replacements right to left, like the source transformer. */
function applyReplacements(
  source: string,
  replacements: ReturnType<typeof createPreviewRuntimeHookReplacements>,
): string {
  let transformed = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    transformed = `${transformed.slice(0, replacement.start)}${replacement.replacement}${transformed.slice(replacement.end)}`;
  }
  return transformed;
}
