/**
 * Verifies that compiler resolution context remains visible after crossing the domain boundary.
 * Import notes are essential when a nested component or asset, rather than the active file, fails.
 */
import { describe, expect, it } from 'vitest';
import { PreviewCompilationError } from '../../src/domain/preview';
import { describeBuildFailure, formatDiagnostic } from '../../src/presentation/previewFailure';

describe('previewFailure', () => {
  /** Formats the primary location and each esbuild resolver note as readable indented lines. */
  it('preserves nested import notes', () => {
    const formatted = formatDiagnostic({
      location: { column: 4, file: 'src/Preview.tsx', line: 3 },
      message: 'Could not resolve "@/components/Card"',
      notes: ['src/components/Card.js:1:0 The JSX loader is required for this imported file.'],
      severity: 'error',
    });

    expect(formatted).toContain('src/Preview.tsx:3:4 Could not resolve "@/components/Card"');
    expect(formatted).toContain('↳ src/components/Card.js:1:0');
  });

  /** Includes preserved notes in the detailed panel description for a compilation failure. */
  it('shows compiler notes in build failure details', () => {
    const failure = describeBuildFailure(
      new PreviewCompilationError('Preview build failed.', [
        {
          message: 'Unsupported imported asset',
          notes: ['Import the file with ?raw when text contents are required.'],
          severity: 'error',
        },
      ]),
    );

    expect(failure.details).toContain('Unsupported imported asset');
    expect(failure.details).toContain('Import the file with ?raw');
  });
});
