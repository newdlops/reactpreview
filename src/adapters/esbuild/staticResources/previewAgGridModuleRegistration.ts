/** Restores AG Grid's package-level module bootstrap when an isolated page omits the app entry. */
import ts from 'typescript';

const AG_GRID_REACT_SPECIFIER = 'ag-grid-react';
const AG_GRID_MODULE_PACKAGES = [
  { allModuleExport: 'AllEnterpriseModule', specifier: 'ag-grid-enterprise' },
  { allModuleExport: 'AllCommunityModule', specifier: 'ag-grid-community' },
] as const;

export type PreviewAgGridModulePackage = 'community' | 'enterprise';

/** Creates one reached-module bootstrap without pulling AG Grid into unrelated preview bundles. */
export function createPreviewAgGridModuleRegistration(
  sourceFile: ts.SourceFile,
  packageKind: PreviewAgGridModulePackage | undefined,
  allocateBinding: (kind: string) => string,
): readonly string[] {
  if (!hasPreviewAgGridReactRuntimeImport(sourceFile) || packageKind === undefined) return [];
  const modulePackage = AG_GRID_MODULE_PACKAGES.find(({ specifier }) =>
    specifier.endsWith(packageKind),
  );
  if (modulePackage === undefined) return [];
  const namespaceBinding = allocateBinding('agGridModules');
  const registryBinding = allocateBinding('agGridRegistry');
  const allModuleBinding = allocateBinding('agGridAllModule');
  return Object.freeze([
    `import * as ${namespaceBinding} from ${JSON.stringify(modulePackage.specifier)};`,
    `const ${registryBinding} = Reflect.get(${namespaceBinding}, 'ModuleRegistry');`,
    `const ${allModuleBinding} = Reflect.get(${namespaceBinding}, ${JSON.stringify(modulePackage.allModuleExport)});`,
    `if (typeof ${registryBinding}?.registerModules === 'function' && ${allModuleBinding} !== undefined) ${registryBinding}.registerModules([${allModuleBinding}]);`,
  ]);
}

/** Accepts only runtime imports/re-exports; erased type references must remain cost-free. */
function hasPreviewAgGridReactRuntimeImport(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === AG_GRID_REACT_SPECIFIER
    ) {
      const clause = statement.importClause;
      if (clause === undefined) return true;
      if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return false;
      if (clause.name !== undefined || clause.namedBindings === undefined) return true;
      return (
        !ts.isNamedImports(clause.namedBindings) ||
        clause.namedBindings.elements.some((element) => !element.isTypeOnly)
      );
    }
    return (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === AG_GRID_REACT_SPECIFIER
    );
  });
}
