/**
 * Allocates readable, collision-free identifiers for generated preview source imports.
 * Keeping this stateful concern outside the main transformer prevents its resource scanners from
 * also owning JavaScript binding policy and leaves room for future transform-specific namespaces.
 */
import type { StaticSourceAnalysis } from './staticCallParser';

/** Per-module allocator backed by the parser's complete decoded identifier inventory. */
export class PreviewSourceBindingAllocator {
  private sequence = 0;

  /** Captures AST-decoded identifiers, including Unicode escapes, types, and nested scopes. */
  public constructor(private readonly analysis: StaticSourceAnalysis) {}

  /**
   * Returns the next generated module binding absent from the complete original source text.
   *
   * @param kind Readable transform category included in the generated identifier.
   * @returns Collision-free JavaScript identifier reserved for one generated import.
   */
  public next(kind: string): string {
    let binding: string;
    do {
      binding = `__reactPreview_${kind}_${this.sequence.toString()}`;
      this.sequence += 1;
    } while (this.analysis.hasIdentifier(binding));
    return binding;
  }
}
