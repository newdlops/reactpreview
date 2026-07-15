/**
 * Installs a deliberately small project-owned styled-components package for bridge fixtures.
 * The fake keeps theme context in module scope, allowing tests to prove that the generated bridge
 * and styled targets resolve the same package instance without adding styled-components here.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Marker embedded in the fake package and exposed through its ThemeProvider function. */
export const FAKE_STYLED_COMPONENTS_MARKER = 'PROJECT_OWNED_STYLED_COMPONENTS_MARKER';

/**
 * Writes the minimal ESM surface required by automatic theme bridge and runtime tests.
 * The implementation supports host-tag factories, template interpolations, `css`, and a provider
 * whose current theme is shared with every styled component created by this exact package copy.
 *
 * @param projectRoot Temporary package root that should own styled-components.
 * @returns Promise resolved after package metadata and implementation are durable.
 */
export async function installFakeStyledComponentsPackage(projectRoot: string): Promise<void> {
  const packageDirectory = path.join(projectRoot, 'node_modules', 'styled-components');
  await mkdir(packageDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify({
        exports: './index.js',
        module: './index.js',
        name: 'styled-components',
        type: 'module',
      }),
      'utf8',
    ),
    writeFile(path.join(packageDirectory, 'index.js'), createFakePackageSource(), 'utf8'),
  ]);
}

/**
 * Creates dependency-free browser source for the fake package.
 * React elements are represented by their public `{ type, props }` shape so the package does not
 * need its own React import and remains usable by the repository's lightweight DOM fixture.
 *
 * @returns JavaScript module source written as the fake styled-components entry.
 */
function createFakePackageSource(): string {
  return [
    `export const projectMarker = ${JSON.stringify(FAKE_STYLED_COMPONENTS_MARKER)};`,
    'let currentTheme = {};',
    '',
    '/** Installs a theme for descendant fake styled components and returns them unchanged. */',
    'export function ThemeProvider({ children, theme }) {',
    "  const nextTheme = typeof theme === 'function' ? theme(currentTheme) : theme;",
    '  currentTheme = nextTheme ?? {};',
    '  globalThis.__fakeStyledComponentsProviderRenders =',
    '    (globalThis.__fakeStyledComponentsProviderRenders ?? 0) + 1;',
    '  return children;',
    '}',
    'ThemeProvider.projectMarker = projectMarker;',
    '',
    '/** Evaluates one template interpolation against the currently provided theme. */',
    'function evaluateInterpolation(interpolation, props) {',
    "  return typeof interpolation === 'function'",
    '    ? interpolation({ ...props, theme: currentTheme })',
    '    : interpolation;',
    '}',
    '',
    '/** Creates a fake styled component that exposes resolved interpolation values as markup. */',
    'function createStyledTemplate(elementType) {',
    '  return (_strings, ...interpolations) => {',
    '    return function FakeStyledComponent(props) {',
    '      const values = interpolations.map((value) => evaluateInterpolation(value, props));',
    '      return {',
    '        type: elementType,',
    '        props: {',
    '          ...props,',
    "          'data-theme-values': values.map((value) => String(value)).join('|'),",
    '        },',
    '      };',
    '    };',
    '  };',
    '}',
    '',
    '/** Supports both styled.div and styled(Component) forms used by component sources. */',
    'function styledFactory(elementType) {',
    '  return createStyledTemplate(elementType);',
    '}',
    'const styled = new Proxy(styledFactory, {',
    '  get(_target, property) {',
    '    return createStyledTemplate(String(property));',
    '  },',
    '});',
    'export default styled;',
    '',
    '/** Produces a stable string-like CSS fragment for theme mixin fixture modules. */',
    'export function css(strings, ...interpolations) {',
    "  return strings.reduce((result, part, index) => result + part + String(interpolations[index] ?? ''), '');",
    '}',
  ].join('\n');
}
