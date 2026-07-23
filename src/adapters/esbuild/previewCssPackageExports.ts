/**
 * Interprets the inert package-export subset shared by CSS resolution and Tailwind preflight.
 *
 * JavaScript resolution deliberately omits the community `style` condition, while stylesheet
 * tools activate it for CSS `@import` rules. Keeping this selection pure lets every caller apply
 * its own filesystem and trust-boundary policy without duplicating conditional-export semantics.
 */

/** Conditions active for an ESM stylesheet import in a browser-oriented preview build. */
const CSS_PACKAGE_EXPORT_CONDITIONS = new Set(['browser', 'default', 'import', 'module', 'style']);

/** Bare npm package identity and its corresponding package-exports subpath. */
export interface PreviewBarePackageSpecifier {
  /** Unscoped or scoped package name used to locate a package root. */
  readonly packageName: string;
  /** Root (`.`) or explicit subpath (`./theme`) used to select an exports entry. */
  readonly exportSubpath: string;
}

/** One conditional target together with proof that the `style` condition selected it. */
interface ConditionalStyleTarget {
  /** Package-relative export target selected in authored condition order. */
  readonly path: string;
  /** Whether the selected condition chain crossed an active `style` key. */
  readonly selectedByStyle: boolean;
}

/**
 * Parses one exact bare npm request without applying filesystem semantics to authored text.
 *
 * @param moduleSpecifier Request with any query or fragment already removed.
 * @returns Package identity and exports subpath, or `undefined` for non-package requests.
 */
export function parsePreviewBarePackageSpecifier(
  moduleSpecifier: string,
): PreviewBarePackageSpecifier | undefined {
  if (
    moduleSpecifier.length === 0 ||
    moduleSpecifier.startsWith('.') ||
    moduleSpecifier.startsWith('/') ||
    moduleSpecifier.startsWith('#') ||
    moduleSpecifier.includes('\\') ||
    /^[a-z][a-z\d+.-]*:/iu.test(moduleSpecifier)
  ) {
    return undefined;
  }

  const segments = moduleSpecifier.split('/');
  const packageSegmentCount = moduleSpecifier.startsWith('@') ? 2 : 1;
  if (
    segments.length < packageSegmentCount ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    return undefined;
  }
  const packageName = segments.slice(0, packageSegmentCount).join('/');
  const requestedSubpath = segments.slice(packageSegmentCount).join('/');
  return {
    exportSubpath: requestedSubpath.length === 0 ? '.' : `./${requestedSubpath}`,
    packageName,
  };
}

/**
 * Selects an exact package subpath only when active condition order chooses `style`.
 *
 * A direct string remains unclaimed because ordinary package resolution already supports it.
 * Conditional object properties are evaluated in authored order, matching package-exports rules:
 * a preceding `default` or JavaScript condition prevents a later `style` entry from taking over.
 *
 * @param exportsValue Untrusted `exports` value parsed from package.json.
 * @param exportSubpath Root (`.`) or exact package subpath requested by the CSS import.
 * @returns Package-relative target selected through `style`, or `undefined`.
 */
export function selectPreviewPackageStyleExport(
  exportsValue: unknown,
  exportSubpath: string,
): string | undefined {
  let selectedValue = exportsValue;
  if (isUnknownRecord(exportsValue)) {
    const keys = Object.keys(exportsValue);
    const containsSubpathKeys = keys.some((key) => key.startsWith('.'));
    if (containsSubpathKeys) {
      selectedValue = Object.prototype.hasOwnProperty.call(exportsValue, exportSubpath)
        ? exportsValue[exportSubpath]
        : undefined;
    } else if (exportSubpath !== '.') {
      selectedValue = undefined;
    }
  } else if (exportSubpath !== '.') {
    selectedValue = undefined;
  }

  const selectedTarget = selectConditionalStyleTarget(selectedValue, false);
  return selectedTarget?.selectedByStyle === true ? selectedTarget.path : undefined;
}

/**
 * Evaluates one conditional target using the active browser stylesheet conditions.
 *
 * @param value String, array fallback, or conditional object from an exact exports entry.
 * @param selectedByStyle Whether an ancestor condition already selected `style`.
 * @returns First active string target and its condition-chain evidence.
 */
function selectConditionalStyleTarget(
  value: unknown,
  selectedByStyle: boolean,
): ConditionalStyleTarget | undefined {
  if (typeof value === 'string') return { path: value, selectedByStyle };
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const selected = selectConditionalStyleTarget(candidate, selectedByStyle);
      if (selected !== undefined) return selected;
    }
    return undefined;
  }
  if (!isUnknownRecord(value)) return undefined;

  for (const [condition, candidate] of Object.entries(value)) {
    if (!CSS_PACKAGE_EXPORT_CONDITIONS.has(condition)) continue;
    const selected = selectConditionalStyleTarget(
      candidate,
      selectedByStyle || condition === 'style',
    );
    if (selected !== undefined) return selected;
  }
  return undefined;
}

/**
 * Narrows untrusted JSON values without accepting arrays.
 *
 * @param value Arbitrary parsed package field.
 * @returns Whether the value can be inspected as an own-property record.
 */
function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
