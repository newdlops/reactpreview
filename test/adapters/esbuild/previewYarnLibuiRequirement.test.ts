/** Verifies exact syntax evidence for the optional Yarn libui Application boundary. */
import { describe, expect, it } from 'vitest';
import { collectPreviewYarnLibuiRequirement } from '../../../src/adapters/esbuild/previewYarnLibuiRequirement';

describe('collectPreviewYarnLibuiRequirement', () => {
  /** Recognizes aliased and namespace runtime use from the two exact package source entries. */
  it('collects ministore consumers and Application owners', () => {
    expect(
      collectPreviewYarnLibuiRequirement(
        '/workspace/Project.tsx',
        "import { useMinistore as useStore } from '@yarnpkg/libui/sources/hooks/useMinistore'; export const Project = () => useStore();",
      ),
    ).toEqual({ consumesMinistore: true, ownsMinistore: false });
    expect(
      collectPreviewYarnLibuiRequirement(
        '/workspace/App.tsx',
        "import * as Libui from '@yarnpkg/libui/sources/components/Application'; export const App = ({ children }) => <Libui.Application>{children}</Libui.Application>;",
      ),
    ).toEqual({ consumesMinistore: false, ownsMinistore: true });
  });

  /** Ignores erased, unused, and similarly named imports. */
  it('does not infer a provider from non-runtime evidence', () => {
    expect(
      collectPreviewYarnLibuiRequirement(
        '/workspace/Types.ts',
        "import type { Application } from '@yarnpkg/libui/sources/components/Application'; import { useMinistore } from '@scope/lookalike'; export type Value = Application;",
      ),
    ).toEqual({ consumesMinistore: false, ownsMinistore: false });
  });
});
