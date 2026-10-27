/** Shares the existing Next control-flow surface between the original and Page Execution roots. */
import { PREVIEW_NEXT_APP_CONTROL_SIGNAL_SYMBOL_KEY } from './previewNextAppNavigationRuntimeSource';

/** Emits a getter-free decoder for the bridge's branded framework control signals. */
export function createPreviewNextAppControlSignalReaderSource(name: string): readonly string[] {
  if (!/^[A-Za-z_$][\w$]*$/u.test(name)) throw new TypeError('Invalid control boundary name');
  return [
    `const ${name}Signal = Symbol.for(${JSON.stringify(PREVIEW_NEXT_APP_CONTROL_SIGNAL_SYMBOL_KEY)});`,
    `function ${name}(error) {`,
    '  try {',
    `    const signal = Object.getOwnPropertyDescriptor(error, ${name}Signal)?.value;`,
    '    if (signal === null || typeof signal !== "object") return undefined;',
    '    const kind = Object.getOwnPropertyDescriptor(signal, "kind")?.value;',
    '    const destination = Object.getOwnPropertyDescriptor(signal, "destination")?.value;',
    '    if (!["redirect", "permanentRedirect", "notFound", "forbidden", "unauthorized"].includes(kind)) return undefined;',
    '    if (destination !== undefined && (typeof destination !== "string" || destination.length > 2048)) return undefined;',
    '    return { kind, ...(destination === undefined ? {} : { destination }) };',
    '  } catch { return undefined; }',
    '}',
  ];
}

/** Emits a local boundary that contains framework guards and requests only proven navigation. */
export function createPreviewNextAppControlBoundarySource(
  name = 'PreviewInspectorNextAppControlBoundary',
): readonly string[] {
  return [
    ...createPreviewNextAppControlSignalReaderSource(`${name}Read`),
    `class ${name} extends React.Component {`,
    '  constructor(props) { super(props); this.state = { error: null }; }',
    '  static getDerivedStateFromError(error) { return { error }; }',
    '  componentDidCatch(error) {',
    `    const signal = ${name}Read(error);`,
    '    if (signal === undefined) return;',
    '    globalThis[Symbol.for("newdlops.react-file-preview.page-inspector")]?.handleNextAppNavigationControl?.(signal, this);',
    '  }',
    '  componentWillUnmount() { this.clearControl(); }',
    '  clearControl() { globalThis[Symbol.for("newdlops.react-file-preview.page-inspector")]?.clearNextAppNavigationControl?.(this); }',
    '  render() {',
    '    const error = this.state.error;',
    '    if (error !== null) {',
    `      const signal = ${name}Read(error);`,
    '      if (signal === undefined) throw error;',
    '      const destination = typeof signal.destination === "string" ? ` · ${signal.destination}` : "";',
    '      return React.createElement("section", {',
    '        "data-react-preview-next-app-control": signal.kind,',
    '        style: { border: "1px dashed #c98b2e", borderRadius: "6px", color: "#7a5318", margin: "8px", padding: "10px" },',
    '      }, React.createElement("strong", null, `Next ${signal.kind}() intercepted${destination}`),',
    '        React.createElement("button", { onClick: () => { this.clearControl(); this.setState({ error: null }); }, style: { marginLeft: "8px" } }, "Retry"));',
    '    }',
    '    return this.props.children;',
    '  }',
    '}',
  ];
}
