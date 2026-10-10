/** Verifies that optional-chain uses complete a prop object other evidence already materializes. */
import { describe, expect, it } from 'vitest';
import { collectReactExportPropInference } from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';

describe('optional chain prop usage', () => {
  /** `user.name` made an object, but `user?.getInitials()` left it without the called method. */
  it('adds members used behind an optional receiver that other uses materialize', () => {
    const source = [
      'export const Avatar = ({ user }: any) => (',
      '  <span title={user.name}>{user?.getInitials()}{user?.profile?.city}</span>',
      ');',
    ].join('\n');

    const inferred = collectReactExportPropInference('/workspace/Avatar.tsx', source);

    expect(inferred.Avatar?.shape.properties?.user).toMatchObject({
      kind: 'object',
      properties: {
        getInitials: { kind: 'function' },
        name: { kind: 'string' },
        profile: { kind: 'object' },
      },
    });
  });

  /** A receiver only ever read optionally stays absent, which the optional chain already allows. */
  it('leaves a prop used only through optional chains absent', () => {
    const source = [
      'export const Badge = ({ user }: any) => <span>{user?.getInitials()}</span>;',
    ].join('\n');

    expect(collectReactExportPropInference('/workspace/Badge.tsx', source).Badge).toBeUndefined();
  });
});
