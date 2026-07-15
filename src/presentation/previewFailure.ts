/**
 * Converts compiler failures and diagnostics into compact presentation-safe text models.
 * HTML encoding remains the webview factory's responsibility, while this module owns source
 * location formatting shared by the panel error state and extension log channel.
 */
import { PreviewCompilationError, type PreviewDiagnostic } from '../domain/preview';

/** User-facing message and optional diagnostic detail derived from an unknown build failure. */
export interface BuildFailureDescription {
  /** Optional structured diagnostic lines shown beneath the summary. */
  readonly details?: string;
  /** Concise failure message shown in the panel. */
  readonly message: string;
}

/**
 * Formats a compiler diagnostic with optional file, line, and column for the log channel.
 *
 * @param diagnostic Compiler warning or error in the domain representation.
 * @returns One readable log line.
 */
export function formatDiagnostic(diagnostic: PreviewDiagnostic): string {
  const location = diagnostic.location;
  if (location === undefined) {
    return diagnostic.message;
  }

  const file = location.file ?? 'unknown source';
  const line = location.line === undefined ? '' : `:${location.line.toString()}`;
  const column = location.column === undefined ? '' : `:${location.column.toString()}`;
  return `${file}${line}${column} ${diagnostic.message}`;
}

/**
 * Converts a domain compilation error or arbitrary failure into safe display strings.
 *
 * @param error Unknown value caught from the application use case.
 * @returns Concise message plus optional formatted compiler diagnostics.
 */
export function describeBuildFailure(error: unknown): BuildFailureDescription {
  if (error instanceof PreviewCompilationError) {
    const details = error.diagnostics.map(formatDiagnostic).join('\n');
    return details.length === 0 ? { message: error.message } : { details, message: error.message };
  }

  return {
    message: error instanceof Error ? error.message : String(error),
  };
}
