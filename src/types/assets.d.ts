/**
 * Supplies editor-time types for style and binary imports used by test fixtures and manual examples.
 * Runtime handling remains owned by the esbuild adapter; these declarations execute no code and do
 * not impose a frontend framework or server on the extension host.
 */

/** Maps CSS Module class names to the scoped names emitted by esbuild's local-css loader. */
declare module '*.module.css' {
  const classNames: Readonly<Record<string, string>>;
  export default classNames;
}

/** Allows side-effect imports of global CSS during strict fixture type checking. */
declare module '*.css';
