/** Generates only the grouped Inspector chrome styles, reusing the existing VS Code theme. */

/** Returns browser CSS declarations; no authored-page selectors or runtime measurements are added. */
export function createPreviewInspectorChromeStyleRuntimeSource(): string {
  return String.raw`
const previewInspectorChromeCss = [
  '.rpi-toolbar{align-content:start;gap:8px;padding:8px}',
  '.rpi-toolbar-primary{align-items:center;display:flex;flex:1 0 100%;flex-wrap:wrap;gap:8px;min-width:0}',
  '.rpi-toolbar-primary>.rpi-title{flex:1 1 180px;font-size:13px;margin:0;white-space:normal}',
  '.rpi-toolbar-actions{align-items:center;display:flex;flex-wrap:wrap;gap:4px;min-width:0}',
  '.rpi-toolbar-primary .rpi-button,.rpi-toolbar-options .rpi-button,.rpi-toolbar-options .rpi-select{min-height:28px}',
  '.rpi-button[data-rpi-variant="primary"]{background:var(--vscode-button-background,#0e639c);border-color:var(--vscode-button-border,transparent);color:var(--vscode-button-foreground,#fff)}',
  '.rpi-button[data-rpi-variant="primary"]:hover{background:var(--vscode-button-hoverBackground,#1177bb)}',
  '.rpi-disclosure{min-width:0}.rpi-disclosure>summary{cursor:pointer;font-size:11px;min-height:28px;overflow-wrap:anywhere;padding:5px 0;touch-action:manipulation}',
  '.rpi-disclosure>summary:hover{color:var(--vscode-textLink-foreground,#3794ff)}',
  '.rpi-disclosure>summary:focus-visible{outline:1px solid var(--vscode-focusBorder,#007fd4);outline-offset:-1px}',
  '.rpi-toolbar-options{flex:1 0 100%}.rpi-toolbar-options>summary{width:max-content;max-width:100%;padding:2px 0}',
  '.rpi-toolbar-options-body{border-top:1px solid var(--rpi-border);display:flex;flex-wrap:wrap;gap:12px 24px;padding:8px 0 4px}',
  '.rpi-toolbar-tool-group,.rpi-toolbar-field{align-content:start;display:grid;gap:4px;max-width:100%;min-width:0}',
  '.rpi-toolbar-tool-group{flex:1 1 220px}.rpi-toolbar-field .rpi-select{max-width:100%;width:100%}',
  '.rpi-toolbar-tool-group>.rpi-button{justify-self:start}.rpi-tool-label{color:var(--rpi-muted);font-size:11px}',
  '.rpi-toolbar-tool-group>.rpi-meta{overflow-wrap:anywhere}',
  '.rpi-neural-controls{border-top:1px solid var(--rpi-border);display:grid;flex:1 0 100%;gap:6px;max-width:100%;min-width:0;padding-top:8px}',
  '.rpi-neural-controls-heading{align-items:center;display:flex;flex-wrap:wrap;gap:6px;min-width:0}',
  '.rpi-neural-controls-heading>strong{font-size:11px;font-weight:600;margin-right:auto}',
  '.rpi-neural-controls-heading>.rpi-button{min-height:28px}',
  '.rpi-context-identity{align-items:baseline;display:flex;flex-wrap:wrap;gap:4px 8px;min-width:0}',
  '.rpi-context-identity>.rpi-context-path{flex:1 1 180px}',
  '.rpi-context-identity>.rpi-context-detail{flex:1 0 100%}',
  '.rpi-page-options{border-top:1px solid var(--rpi-border)}',
  '.rpi-page-options-body{display:grid;gap:8px;min-width:0;padding:4px 0}',
  '.rpi-tree-guide>summary{color:var(--rpi-muted);font-size:10px;min-height:24px;padding:2px 0}',
  '.rpi-tree-guide .rpi-tree-legend{padding:4px 0}',
  '.rpi-navigation-tabs>.rpi-tab{flex:1 1 0;font-size:11px;min-width:0;padding:7px 4px;white-space:normal;overflow-wrap:anywhere}',
  '.rpi-navigation-tabs{gap:0}.rpi-navigation-heading{padding:0}',
  '.rpi-workbench{min-height:160px}',
  '.rpi-shell{overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain}',
  '.rpi-toolbar{max-height:min(42dvh,400px)}.rpi-page-context{max-height:min(40dvh,360px)}',
  '@container rpi-inspector (max-width:460px){.rpi-toolbar-primary>.rpi-title{flex-basis:100%}',
  '.rpi-toolbar-primary>.rpi-toolbar-actions{flex:1 0 100%}.rpi-toolbar-primary>.rpi-toolbar-actions>.rpi-button{flex:1 1 auto}',
  '.rpi-neural-controls-heading>strong{flex-basis:100%}.rpi-toolbar-options-body{gap:12px}}',
  '@media(pointer:coarse){.rpi-toolbar .rpi-button,.rpi-toolbar .rpi-select,.rpi-disclosure>summary,.rpi-navigation-tabs>.rpi-tab{min-height:44px}}',
].join('');
`;
}
