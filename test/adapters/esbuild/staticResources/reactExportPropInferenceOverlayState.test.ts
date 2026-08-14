/** Proves imported enum-backed overlays receive their authored visible state. */
import { describe, expect, it } from 'vitest';
import { collectReactExportPropInference } from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';

describe('collectReactExportPropInference overlay state', () => {
  /** Resolves the positive transition member through an inert project barrel. */
  it('infers an exact imported overlay state from its active transition comparison', () => {
    const source = [
      "import { Portal, State, TransitionAnimate } from '@ui/common';",
      'interface Props { state: State.Default | State.Hidden; children?: React.ReactNode }',
      'export const PopUp = ({ state = State.Hidden, children }: Props) => (',
      '  <Portal id="pop-up-root">',
      '    <TransitionAnimate active={state === State.Default}>',
      '      <section>{children}</section>',
      '    </TransitionAnimate>',
      '  </Portal>',
      ');',
    ].join('\n');
    const result = collectReactExportPropInference('/workspace/PopUp.tsx', source, {
      resolveImport: (specifier) => {
        if (specifier === '@ui/common') {
          return {
            sourcePath: '/workspace/common/index.ts',
            sourceText: "export * from './ComponentStates';",
          };
        }
        if (specifier === './ComponentStates') {
          return {
            sourcePath: '/workspace/common/ComponentStates.ts',
            sourceText: "export enum State { Default = 'Default', Hidden = 'Hidden' }",
          };
        }
        return undefined;
      },
    });

    expect(result.PopUp?.shape.properties?.state).toEqual({
      exactValue: true,
      kind: 'string',
      value: 'Default',
    });
  });

  /** Maps a rest-bound child back to the public root and supplies visible overlay content. */
  it('renders a bounded label through a rest-bound Toast children slot', () => {
    const source = [
      "import { Portal, State, TransitionAnimate } from '@ui/common';",
      'interface Option { state?: State.Default | State.Hidden; children?: React.ReactNode }',
      'export const Toast = ({ state = State.Hidden, ...props }: Option) => {',
      '  return <Portal id="toast-root">',
      '    <TransitionAnimate active={state === State.Default}>',
      '      <p>{props.children}</p>',
      '    </TransitionAnimate>',
      '  </Portal>;',
      '};',
    ].join('\n');
    const result = collectReactExportPropInference('/workspace/Toast.tsx', source, {
      resolveImport: (specifier) => {
        if (specifier === '@ui/common') {
          return {
            sourcePath: '/workspace/common/index.ts',
            sourceText: "export * from './ComponentStates';",
          };
        }
        if (specifier === './ComponentStates') {
          return {
            sourcePath: '/workspace/common/ComponentStates.ts',
            sourceText: "export enum State { Default = 'Default', Hidden = 'Hidden' }",
          };
        }
        return undefined;
      },
    });

    expect(result.Toast?.shape.properties).toEqual({
      children: { kind: 'string', value: 'Toast' },
      state: { exactValue: true, kind: 'string', value: 'Default' },
    });
  });
});
