/**
 * A source-bound immutable expression.  Route analysis passes this value between readers instead
 * of reducing a binding to a string, which keeps same-file aliases and re-exports unambiguous.
 */
import ts from 'typescript';

export interface PreviewInspectorStaticValueReference {
  readonly exportName?: string;
  readonly expression: ts.Expression;
  readonly sourceFile: ts.SourceFile;
  readonly sourcePath: string;
}
