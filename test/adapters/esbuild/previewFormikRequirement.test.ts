/** Verifies syntax-only Formik consumer/provider evidence used by the automatic static boundary. */
import { describe, expect, it } from 'vitest';
import { collectPreviewFormikRequirement } from '../../../src/adapters/esbuild/previewFormikRequirement';

describe('collectPreviewFormikRequirement', () => {
  /** Tracks a directly used consumer while retaining its local import alias. */
  it('detects named consumer imports and aliases', () => {
    expect(
      collectPreviewFormikRequirement(
        '/workspace/Field.tsx',
        "import { useField as readField } from 'formik'; export const Field = () => readField('name');",
      ),
    ).toEqual({ consumesFormik: true, ownsFormik: false });
  });

  /** Detects the namespace use pattern employed by project-owned form helper hooks. */
  it('classifies namespace properties only when accessed', () => {
    expect(
      collectPreviewFormikRequirement(
        '/workspace/use-field.ts',
        "import * as formik from 'formik'; export const useValue = () => formik.useField('value');",
      ),
    ).toEqual({ consumesFormik: true, ownsFormik: false });
    expect(
      collectPreviewFormikRequirement(
        '/workspace/constants.ts',
        "import * as formik from 'formik'; export const marker = 'formik';",
      ),
    ).toEqual({ consumesFormik: false, ownsFormik: false });
  });

  /** Keeps provider ownership independent from consumer evidence for graph aggregation. */
  it('detects direct and namespace provider APIs', () => {
    expect(
      collectPreviewFormikRequirement(
        '/workspace/Form.tsx',
        "import { FormikProvider, useFormikContext } from 'formik'; export { FormikProvider, useFormikContext };",
      ),
    ).toEqual({ consumesFormik: true, ownsFormik: true });
    expect(
      collectPreviewFormikRequirement(
        '/workspace/Form.tsx',
        "import * as Forms from 'formik'; export const Provider = Forms.Formik;",
      ),
    ).toEqual({ consumesFormik: false, ownsFormik: true });
  });

  /** Ignores erased, unused, malformed, and similarly named project imports. */
  it('fails closed for sources without runtime Formik evidence', () => {
    for (const source of [
      "import type { FormikProps } from 'formik'; export type Props = FormikProps<unknown>;",
      "import { useField } from 'formik'; export const marker = 'unused';",
      "import { useField } from './formik'; export const Field = () => useField('name');",
      "import { useField } from 'formik'; const broken = ;",
    ]) {
      expect(collectPreviewFormikRequirement('/workspace/Preview.tsx', source)).toEqual({
        consumesFormik: false,
        ownsFormik: false,
      });
    }
  });
});
