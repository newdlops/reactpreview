/**
 * Registers typed GraphQL documents with their declared result shapes for the Page Inspector.
 *
 * Generated statements are appended to the module, so registrations run after every module-scope
 * binding is initialized. They push into a global queue instead of calling the Inspector API
 * because page modules can evaluate before the Inspector runtime installs itself; the Apollo
 * bridge reads the queue by operation name when it describes a request to the Virtual Backend.
 */
import type { PreviewTypeOracleView } from '../typeOracle/previewTypeOracle';

/** `Symbol.for` key of the queue of `[document, shape]` pairs shared with the Apollo runtime. */
export const PREVIEW_TYPED_GRAPHQL_DOCUMENTS_KEY =
  'newdlops.react-file-preview.typed-graphql-documents';

const MAX_SHAPE_SOURCE_LENGTH = 64 * 1024;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/u;

/**
 * Creates one guarded registration statement per typed document binding of a module.
 *
 * @param oracle Build-scoped declared-type oracle, absent outside Page Inspector builds.
 * @param sourcePath Absolute module path.
 * @returns Statements to append to the module; empty when nothing qualified.
 */
export function createPreviewTypedDocumentRegistrations(
  oracle: PreviewTypeOracleView | undefined,
  sourcePath: string,
): readonly string[] {
  if (oracle === undefined) return [];
  const key = JSON.stringify(PREVIEW_TYPED_GRAPHQL_DOCUMENTS_KEY);
  return oracle.readTypedDocumentShapes(sourcePath).flatMap(({ identifier, shape }) => {
    const shapeSource = JSON.stringify(shape);
    if (!IDENTIFIER_PATTERN.test(identifier) || shapeSource.length > MAX_SHAPE_SOURCE_LENGTH) {
      return [];
    }
    return [
      `try { const registry = globalThis[Symbol.for(${key})] || (globalThis[Symbol.for(${key})] = []); registry.push([${identifier}, ${shapeSource}]); } catch {}`,
    ];
  });
}
