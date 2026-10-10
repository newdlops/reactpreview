/**
 * Connects backend-request instrumentation to declared response types.
 *
 * Request instrumentation finds the response type node syntactically (`client.get<T>()`,
 * `response.json<T>()`, `as T`) but can only expand interfaces declared in the same module. An API
 * layer usually imports `T` from a shared types module, so its fields, lists, and literal unions
 * were lost and the payload fell back to endpoint names. The build's oracle resolves the same node
 * in the analysis program instead.
 */
import ts from 'typescript';
import type { PreviewTypeOracleView } from '../typeOracle/previewTypeOracle';
import type { PreviewDataTypedShapeResolver } from './previewDataRequestInstrumentation';

/**
 * Adapts a build's oracle view to the request instrumentation's type-node callback.
 *
 * @param oracle Build-scoped oracle, absent outside Page Inspector builds.
 * @param sourcePath Absolute module path being transformed.
 * @returns Resolver, or `undefined` so request shapes stay syntax-based.
 */
export function createPreviewTypedResponseShapeResolver(
  oracle: PreviewTypeOracleView | undefined,
  sourcePath: string,
): PreviewDataTypedShapeResolver | undefined {
  if (oracle === undefined) return undefined;
  return (typeNode, sourceFile) =>
    oracle.readTypedResponseShape({
      occurrence: readPreviewTypeNodeOccurrence(sourceFile, typeNode),
      sourcePath,
      typeText: typeNode.getText(sourceFile),
    });
}

/**
 * Counts earlier type nodes with identical text, in the same pre-order the oracle uses.
 *
 * @param sourceFile Parse of the instrumented module.
 * @param typeNode Type node inside that parse.
 * @returns Zero-based occurrence index used to find the same node in the analysis program.
 */
export function readPreviewTypeNodeOccurrence(
  sourceFile: ts.SourceFile,
  typeNode: ts.TypeNode,
): number {
  const typeText = typeNode.getText(sourceFile);
  let occurrence = 0;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node === typeNode) {
      found = true;
      return;
    }
    if (ts.isTypeNode(node) && node.getText(sourceFile) === typeText) occurrence += 1;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return occurrence;
}
