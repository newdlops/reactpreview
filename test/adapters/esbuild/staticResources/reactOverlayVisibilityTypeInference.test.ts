/** Verifies visibility inference from exact utility-type keys without guessing unresolved contracts. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { inferReactOverlayVisibilityTypePath } from '../../../../src/adapters/esbuild/staticResources/reactOverlayVisibilityTypeInference';

describe('overlay utility type visibility', () => {
  it('retains one exact Pick key from an unresolved overlay contract', () => {
    expect(visibilityPath('Pick<ModalProps, "show" | "onClose">')).toEqual(['show']);
  });

  it('rejects ambiguous keys, omitted keys, and non-overlay contracts', () => {
    expect(visibilityPath('Pick<ModalProps, "show" | "open">')).toBeUndefined();
    expect(visibilityPath('Omit<ModalProps, "onClose">')).toBeUndefined();
    expect(visibilityPath('Pick<Settings, "show">')).toBeUndefined();
  });

  it('retains a resolved non-boolean declaration over the unresolved-key fallback', () => {
    expect(
      visibilityPath('Pick<ModalProps, "show">', 'type ModalProps = { show: string };'),
    ).toBeUndefined();
  });
});

/** Parses an inert props corridor and returns the visibility path inferred for its overlay export. */
function visibilityPath(props: string, declarations = ''): readonly string[] | undefined {
  const source = ts.createSourceFile(
    '/workspace/DocumentModal.tsx',
    `${declarations} type Props = ${props}; export function DocumentModal(props: Props) { return null; }`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const component = source.statements.find(ts.isFunctionDeclaration);
  if (component === undefined) throw new Error('Missing overlay fixture.');
  return inferReactOverlayVisibilityTypePath(component, 'DocumentModal', undefined, source);
}
