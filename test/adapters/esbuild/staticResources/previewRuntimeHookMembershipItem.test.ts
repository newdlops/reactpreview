/** Verifies exact membership items without executing imported permission modules. */
import { describe, expect, it } from 'vitest';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

describe('runtime hook membership item inference', () => {
  /** Keeps an exact permission enum member inside a generated selector collection. */
  it('satisfies an includes permission gate with its authored enum member', () => {
    const source = [
      `import { useSelector } from 'react-redux';`,
      `import Permissions from './Permissions';`,
      'export function Patients() {',
      '  const permissions = useSelector((state) => state.user.permissions);',
      '  return permissions.includes(Permissions.ReadPatients) ? <main>Patients</main> : null;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Patients.tsx', source),
    );

    expect(transformed).toContain('() => (Object.freeze([Permissions.ReadPatients]))');
    expect(transformed).toContain('"fallbackLabel":"generated one-item list from local usage"');
    expect(transformed).toContain('"requiredPaths":["[]"]');
  });

  /** Does not reinterpret String.prototype.includes as an Array membership contract. */
  it('keeps includes on a string-semantic hook binding out of collection inference', () => {
    const source = [
      `import { useMessage } from './use-message';`,
      `import Permissions from './Permissions';`,
      'export function Notice() {',
      '  const message = useMessage();',
      '  return message.includes(Permissions.ReadPatients) ? <span>{message}</span> : null;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Notice.tsx', source),
    );

    expect(transformed).not.toContain('Object.freeze([Permissions.ReadPatients])');
  });

  /** Carries an exact enum member through an alias once a reached child proves the value is Array. */
  it('combines child Array demand with an aliased static membership item', () => {
    const source = [
      `import { useMeetingFormContext } from './meeting-form-context';`,
      `import { AgendaInput } from './agenda-input';`,
      `import { AGENDA } from './agenda-constants';`,
      'export function AgendaInputSection() {',
      '  const { formikProps } = useMeetingFormContext();',
      '  const agendaSelection = formikProps.values.agendaSelection;',
      '  const selected = agendaSelection.includes(AGENDA.CEO_ADDRESS_CHANGE);',
      '  return <AgendaInput selected={selected} agendaSelection={agendaSelection} />;',
      '}',
    ].join('\n');
    const childDemands = new Map([
      [
        'AgendaInput',
        new Map([
          ['agendaSelection', { kind: 'array' as const }],
          ['selected', { kind: 'boolean' as const }],
        ]),
      ],
    ]);

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements(
        '/workspace/AgendaInputSection.tsx',
        source,
        childDemands,
      ),
    );

    expect(transformed).toContain('() => (AGENDA.CEO_ADDRESS_CHANGE)');
    expect(transformed).toContain('formikProps.values.agendaSelection[]');
    expect(transformed).not.toContain('Object.freeze({ id: "preview-id", name: "name" })');
  });
});

/** Applies replacements with the production transformer's right-to-left offset policy. */
function applyHookReplacements(
  source: string,
  replacements: ReturnType<typeof createPreviewRuntimeHookReplacements>,
): string {
  let transformed = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    transformed = `${transformed.slice(0, replacement.start)}${replacement.replacement}${transformed.slice(replacement.end)}`;
  }
  return transformed;
}
