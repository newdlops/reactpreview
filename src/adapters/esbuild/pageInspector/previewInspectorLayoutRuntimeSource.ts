/**
 * Generates the isolated Page Inspector layout controller and Shadow DOM stylesheet.
 *
 * Layout state is deliberately separate from component-tree semantics: the controller only owns
 * drawer dimensions, floating coordinates, pointer/keyboard gestures, and viewport clamping. This
 * keeps project React state untouched while letting the Inspector move away from important content.
 */

/**
 * Creates browser source for resizable bottom/side drawers and a movable floating Inspector.
 *
 * Expected generated-entry bindings are `React`, `previewInspectorSession`, and
 * `persistPreviewInspectorState`. Values are stored as finite viewport-clamped numbers so hot
 * reload and VS Code webview-state restoration cannot revive an off-screen panel.
 *
 * @returns Plain JavaScript source concatenated before the DevTools component-tree UI.
 */
export function createPreviewInspectorLayoutRuntimeSource(): string {
  return String.raw`
/** CSS is scoped by the Inspector Shadow Root and cannot alter the rendered application page. */
const previewInspectorDevtoolsCss = [
  ':host{all:initial!important;color-scheme:light dark!important}',
  '*,*::before,*::after{box-sizing:border-box}',
  'button,input,select,textarea{font:inherit}',
  '.rpi-shell{--rpi-border:var(--vscode-panel-border,#454545);--rpi-muted:var(--vscode-descriptionForeground,#999);',
  'background:var(--vscode-editor-background,#1e1e1e);border:1px solid var(--rpi-border);',
  'box-shadow:0 8px 28px rgba(0,0,0,.38);color:var(--vscode-editor-foreground,#ddd);',
  'container-name:rpi-inspector;container-type:inline-size;display:grid;font:12px/1.4 var(--vscode-font-family,sans-serif);',
  'grid-template-rows:28px minmax(0,var(--rpi-toolbar-section-height,auto)) 9px 28px minmax(0,var(--rpi-context-section-height,auto)) 9px minmax(0,1fr);',
  'max-height:calc(100dvh - 16px);max-width:calc(100vw - 16px);min-width:0;',
  'overflow:hidden;pointer-events:auto;position:fixed;z-index:2147483647}',
  '.rpi-shell>.rpi-shell-section-accordion[data-rpi-accordion-id="shell-toolbar"]{grid-row:1}.rpi-shell>.rpi-toolbar{grid-row:2}',
  '.rpi-shell>.rpi-shell-section-height-handle[data-rpi-shell-region="toolbar"]{grid-row:3}',
  '.rpi-shell>.rpi-shell-section-accordion[data-rpi-accordion-id="shell-page-context"]{grid-row:4}.rpi-shell>.rpi-page-context{grid-row:5}',
  '.rpi-shell>.rpi-shell-section-height-handle[data-rpi-shell-region="context"]{grid-row:6}.rpi-shell>.rpi-workbench{grid-row:7}',
  '.rpi-shell[data-react-preview-companion-source="true"]{display:none!important}',
  '.rpi-shell[data-dock="floating"]{border-radius:5px}',
  '.rpi-toolbar{align-items:center;background:var(--vscode-sideBar-background,#252526);border-bottom:1px solid var(--rpi-border);',
  'display:flex;flex-wrap:wrap;gap:6px;max-width:100%;min-height:36px;overflow:auto;overflow-anchor:none;overscroll-behavior:contain;padding:5px 7px;scrollbar-gutter:stable}',
  '.rpi-title{font-weight:650;margin-right:3px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-neural-status{align-items:center;border:1px solid currentColor;border-radius:10px;display:inline-flex;flex:0 1 auto;gap:5px;',
  'font-size:9px;font-weight:700;line-height:18px;max-width:min(190px,100%);min-width:0;padding:0 7px;white-space:nowrap}',
  '.rpi-neural-status[data-phase="learning"],.rpi-neural-status[data-phase="applying"]{background:color-mix(in srgb,var(--vscode-progressBar-background,#0e70c0) 12%,transparent);',
  'color:var(--vscode-symbolIcon-interfaceForeground,#75beff)}',
  '.rpi-neural-status[data-phase="learned"],.rpi-neural-status[data-phase="applied"],.rpi-neural-status[data-phase="unchanged"]{background:color-mix(in srgb,var(--vscode-testing-iconPassed,#73c991) 10%,transparent);',
  'color:var(--vscode-testing-iconPassed,#73c991)}',
  '.rpi-neural-status[data-phase="needs-choice"]{background:color-mix(in srgb,var(--vscode-charts-yellow,#cca700) 10%,transparent);',
  'color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-neural-status[data-phase="paused"]{background:color-mix(in srgb,var(--vscode-errorForeground,#f48771) 10%,transparent);',
  'color:var(--vscode-errorForeground,#f48771)}',
  '.rpi-neural-status[data-phase="yielded"]{background:color-mix(in srgb,var(--vscode-descriptionForeground,#9d9d9d) 8%,transparent);',
  'color:var(--vscode-descriptionForeground,#9d9d9d)}',
  '.rpi-neural-status-indicator{align-items:center;display:inline-flex;flex:0 0 10px;font-size:9px;height:10px;justify-content:center;width:10px}',
  '.rpi-neural-status[data-phase="learning"]>.rpi-neural-status-indicator,.rpi-neural-status[data-phase="applying"]>.rpi-neural-status-indicator{animation:rpi-neural-learning-spin .8s linear infinite;',
  'border:1.5px solid currentColor;border-radius:50%;border-right-color:transparent}',
  '.rpi-neural-status-label{min-width:0;overflow:hidden;text-overflow:ellipsis}',
  '.rpi-neural-choice-list{background:color-mix(in srgb,var(--vscode-charts-yellow,#cca700) 6%,transparent);border:1px solid var(--rpi-border);',
  'border-left:3px solid var(--vscode-charts-yellow,#cca700);border-radius:4px;display:grid;flex:1 0 100%;margin:1px 0 0;max-height:min(52dvh,520px);max-width:100%;min-height:0;min-width:0;overflow:hidden;padding:7px 8px}',
  '.rpi-neural-choice-list>legend{color:var(--vscode-charts-yellow,#cca700);font-size:10px;font-weight:800;padding:0 4px}',
  '.rpi-neural-choice-scroll{display:grid;gap:7px;max-height:min(46dvh,470px);min-height:0;min-width:0;overflow-x:hidden;overflow-y:auto;',
  'overscroll-behavior:contain;scrollbar-gutter:stable;scrollbar-width:thin;touch-action:pan-y}',
  '.rpi-neural-choice-intro{color:var(--rpi-muted);font-size:10px;min-width:0;overflow-wrap:anywhere}',
  '.rpi-neural-choice-paths{background:color-mix(in srgb,var(--vscode-focusBorder,#007fd4) 5%,transparent);border:1px solid var(--rpi-border);border-radius:3px;display:grid;gap:6px;min-width:0;padding:7px}',
  '.rpi-neural-choice-path-heading{align-items:baseline;display:flex;gap:7px;justify-content:space-between;min-width:0}',
  '.rpi-neural-choice-path-heading>strong{min-width:0;overflow-wrap:anywhere}.rpi-neural-choice-path-heading>span{color:var(--rpi-muted);flex:0 0 auto;font-size:9px}',
  '.rpi-neural-choice-path-recommendation{align-items:center;display:grid;gap:7px;grid-template-columns:minmax(0,1fr) auto;min-width:0}',
  '.rpi-neural-choice-path-actions{display:flex;flex:0 0 auto;flex-wrap:wrap;gap:5px;justify-content:flex-end}',
  '.rpi-neural-choice-path-recommendation .rpi-neural-choice-path-actions>.rpi-button:first-child{background:var(--vscode-button-background,#0e639c);border-color:var(--vscode-button-border,transparent);color:var(--vscode-button-foreground,#fff)}',
  '.rpi-neural-choice-path-recommendation .rpi-neural-choice-path-actions>.rpi-button:first-child:hover{background:var(--vscode-button-hoverBackground,#1177bb)}',
  '.rpi-neural-choice-path-copy{display:grid;gap:1px;min-width:0}.rpi-neural-choice-path-copy>span{color:var(--rpi-muted);font-size:9px;text-transform:uppercase}',
  '.rpi-neural-choice-path-copy>strong{font-size:10px;min-width:0;overflow-wrap:anywhere}',
  '.rpi-neural-choice-path-cycle,.rpi-neural-choice-path-verified,.rpi-neural-choice-path-note{font-size:9px;line-height:1.4;overflow-wrap:anywhere}',
  '.rpi-neural-choice-path-cycle{color:var(--vscode-charts-yellow,#cca700)}.rpi-neural-choice-path-verified{color:var(--vscode-testing-iconPassed,#73c991)}',
  '.rpi-neural-choice-path-alternatives{font-size:10px;min-width:0}.rpi-neural-choice-path-alternatives>summary{color:var(--vscode-textLink-foreground,#3794ff);cursor:pointer;outline:none;width:max-content;max-width:100%}',
  '.rpi-neural-choice-path-alternatives>ol{display:grid;gap:3px;list-style-position:inside;margin:5px 0 0;max-height:160px;min-width:0;overflow:auto;padding:0;scrollbar-gutter:stable}',
  '.rpi-neural-choice-path-alternatives li{border-left:2px solid transparent;display:grid;gap:4px;grid-template-columns:minmax(0,1fr) auto;min-width:0;padding:3px 5px}',
  '.rpi-neural-choice-path-item-copy{display:grid;gap:1px;min-width:0}.rpi-neural-choice-path-item-copy>span{min-width:0;overflow-wrap:anywhere}.rpi-neural-choice-path-item-copy>strong{color:var(--vscode-charts-yellow,#cca700);font-size:9px}',
  '.rpi-neural-choice-path-alternatives li[data-path-status="verified"] .rpi-neural-choice-path-item-copy>strong{color:var(--vscode-testing-iconPassed,#73c991)}.rpi-neural-choice-path-alternatives li[data-path-status="blocked"] .rpi-neural-choice-path-item-copy>strong{color:var(--vscode-errorForeground,#f48771)}',
  '.rpi-neural-choice-path-alternatives li[data-recommended="true"]{background:color-mix(in srgb,var(--vscode-charts-yellow,#cca700) 8%,transparent);border-left-color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-neural-choice-path-alternatives li[data-selected="true"]{background:color-mix(in srgb,var(--vscode-focusBorder,#007fd4) 10%,transparent);border-left-color:var(--vscode-focusBorder,#007fd4)}',
  '.rpi-neural-choice-block{border:1px solid var(--rpi-border);border-radius:3px;display:grid;gap:7px;min-width:0;padding:7px}',
  '.rpi-neural-choice-block-heading{align-items:baseline;display:flex;gap:7px;justify-content:space-between;min-width:0}',
  '.rpi-neural-choice-block-heading>strong{min-width:0;overflow-wrap:anywhere}.rpi-neural-choice-block-heading>span{color:var(--rpi-muted);flex:0 0 auto;font-size:9px}',
  '.rpi-neural-choice-empty{color:var(--rpi-muted);font-size:10px;overflow-wrap:anywhere}',
  '.rpi-neural-choice-group{display:grid;gap:5px;min-width:0}.rpi-neural-choice-group+.rpi-neural-choice-group{border-top:1px solid var(--rpi-border);padding-top:7px}',
  '.rpi-neural-choice-heading{align-items:baseline;display:flex;gap:7px;justify-content:space-between;min-width:0}',
  '.rpi-neural-choice-heading>strong{font-family:var(--vscode-editor-font-family,monospace);min-width:0;overflow-wrap:anywhere}',
  '.rpi-neural-choice-heading>span{color:var(--rpi-muted);flex:0 1 auto;font-size:9px;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-neural-choice-options{display:flex;flex-wrap:wrap;gap:5px;list-style:none;margin:0;min-width:0;padding:0}',
  '.rpi-neural-choice-options>li{display:grid;flex:1 1 150px;gap:2px;max-width:100%;min-width:min(150px,100%)}.rpi-neural-choice-options .rpi-button{max-width:100%;overflow-wrap:anywhere;text-align:left;white-space:normal;width:100%}',
  '.rpi-neural-choice-option-copy{color:var(--rpi-muted);font-size:9px;line-height:1.35;overflow-wrap:anywhere;padding:0 2px}',
  '.rpi-neural-choice-footer{align-items:center;color:var(--rpi-muted);display:flex;font-size:9px;gap:7px;justify-content:space-between;min-width:0}',
  '.rpi-neural-choice-footer>span{min-width:0;overflow-wrap:anywhere}.rpi-neural-choice-actions{display:flex;flex:0 0 auto;flex-wrap:wrap;gap:5px;justify-content:flex-end}',
  '@keyframes rpi-neural-learning-spin{to{transform:rotate(360deg)}}',
  '@media(prefers-reduced-motion:reduce){.rpi-neural-status-indicator{animation:none!important}}',
  '.rpi-spacer{flex:1 1 auto}',
  '.rpi-button,.rpi-select,.rpi-search{background:var(--vscode-input-background,#3c3c3c);border:1px solid var(--rpi-border);',
  'border-radius:3px;color:inherit;min-height:25px;outline:none}',
  '.rpi-button{cursor:pointer;max-width:100%;overflow-wrap:anywhere;padding:2px 7px}',
  '.rpi-toolbar>.rpi-button,.rpi-toolbar>.rpi-select,.rpi-toolbar>.rpi-title{flex:0 1 auto}',
  '.rpi-button:hover{background:var(--vscode-list-hoverBackground,#2a2d2e)}',
  '.rpi-button:focus-visible,.rpi-select:focus-visible,.rpi-search:focus-visible,.rpi-tree-row:focus-visible,.rpi-tab:focus-visible,.rpi-route-summary:focus-visible,.rpi-route-crumb:focus-visible,.rpi-route-folder:focus-visible,.rpi-route-item:focus-visible,.rpi-neural-choice-scroll:focus-visible,.rpi-neural-choice-path-alternatives>summary:focus-visible,.rpi-page-paths:focus-visible,.rpi-page-path-list:focus-visible,',
  '.rpi-resize-handle:focus-visible,.rpi-move-handle:focus-visible,.rpi-card-height-handle:focus-visible,',
  '.rpi-section-height-handle:focus-visible,.rpi-shell-section-height-handle:focus-visible,.rpi-section-accordion-toggle:focus-visible{outline:1px solid var(--vscode-focusBorder,#007fd4);outline-offset:-1px}',
  '.rpi-button[aria-pressed="true"]{background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff)}',
  '.rpi-button[role="switch"][aria-checked="true"]{background:color-mix(in srgb,var(--vscode-button-background,#0e639c) 35%,transparent);border-color:var(--vscode-focusBorder,#007fd4)}',
  '.rpi-button:disabled{cursor:default;opacity:.45}',
  '.rpi-button[aria-busy="true"]:disabled{cursor:progress;opacity:.8}',
  '.rpi-select{max-width:min(210px,100%);min-width:0;padding:2px 5px}',
  '.rpi-page-context{align-content:start;align-items:start;background:var(--vscode-breadcrumb-background,var(--vscode-editor-background,#1e1e1e));',
  'border-bottom:1px solid var(--rpi-border);display:grid;gap:6px;grid-auto-flow:row;grid-auto-rows:max-content;grid-template-columns:minmax(0,1fr);max-width:100%;min-width:0;',
  'overflow:auto;overflow-anchor:none;overscroll-behavior:contain;padding:6px 8px;scrollbar-gutter:stable}',
  '.rpi-page-context>*{grid-column:1!important;grid-row:auto!important;max-width:100%;min-width:0}',
  '.rpi-context-badge{background:var(--vscode-badge-background,#4d4d4d);border-radius:9px;color:var(--vscode-badge-foreground,#fff);',
  'font-size:9px;font-weight:700;justify-self:start;line-height:17px;max-width:100%;overflow:hidden;padding:0 6px;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-context-path{font-family:var(--vscode-editor-font-family,monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-context-detail{color:var(--rpi-muted);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-friendly-status{align-items:center;border:1px solid var(--rpi-border);border-left-width:4px;border-radius:4px;',
  'display:grid;gap:8px;grid-column:1/-1;grid-template-columns:28px minmax(0,1fr) auto auto;max-width:100%;min-width:0;padding:8px 9px}',
  '.rpi-friendly-status[data-status-kind="ready"]{background:color-mix(in srgb,var(--vscode-testing-iconPassed,#73c991) 9%,transparent);',
  'border-left-color:var(--vscode-testing-iconPassed,#73c991)}',
  '.rpi-friendly-status[data-status-kind="blocked"]{background:color-mix(in srgb,var(--vscode-errorForeground,#f48771) 10%,transparent);',
  'border-left-color:var(--vscode-errorForeground,#f48771)}',
  '.rpi-friendly-status[data-status-kind="error"]{background:color-mix(in srgb,var(--vscode-errorForeground,#f48771) 10%,transparent);',
  'border-left-color:var(--vscode-errorForeground,#f48771)}',
  '.rpi-friendly-status[data-status-kind="choice"]{background:color-mix(in srgb,var(--vscode-charts-yellow,#cca700) 9%,transparent);',
  'border-left-color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-friendly-status[data-status-kind="resolving"],.rpi-friendly-status[data-status-kind="automatic"]{',
  'background:color-mix(in srgb,var(--vscode-progressBar-background,#0e70c0) 9%,transparent);border-left-color:var(--vscode-progressBar-background,#0e70c0)}',
  '.rpi-friendly-status[data-status-kind="diagnostic"]{background:color-mix(in srgb,var(--vscode-charts-yellow,#cca700) 9%,transparent);',
  'border-left-color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-friendly-status[data-status-kind="overview"]{background:color-mix(in srgb,var(--vscode-symbolIcon-interfaceForeground,#75beff) 9%,transparent);',
  'border-left-color:var(--vscode-symbolIcon-interfaceForeground,#75beff)}',
  '.rpi-friendly-status[data-status-kind="flow-outcome"]{background:color-mix(in srgb,var(--vscode-charts-yellow,#cca700) 7%,transparent);',
  'border-left-color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-friendly-status[data-status-kind="preparing"]{border-left-color:var(--vscode-progressBar-background,#0e70c0)}',
  '.rpi-friendly-status-icon{align-items:center;border:1px solid currentColor;border-radius:50%;display:flex;font-size:14px;',
  'font-weight:800;height:24px;justify-content:center;width:24px}',
  '.rpi-friendly-status-copy{display:grid;gap:1px;min-width:0}.rpi-friendly-status-copy>strong{font-size:12px}',
  '.rpi-friendly-status-copy>span{color:var(--rpi-muted);font-size:10px;overflow-wrap:anywhere}',
  '.rpi-friendly-status-steps{align-items:center;display:flex!important;flex-wrap:wrap;gap:4px;margin-top:3px}',
  '.rpi-friendly-status-step{border:1px solid var(--rpi-border);border-radius:10px;color:inherit!important;padding:1px 6px}',
  '.rpi-friendly-status-step[data-state="blocked"]{border-color:var(--vscode-errorForeground,#f48771);color:var(--vscode-errorForeground,#f48771)!important}',
  '.rpi-friendly-status>.rpi-button{min-width:0;white-space:normal}.rpi-friendly-status>.rpi-context-badge{grid-row:auto}',
  '.rpi-tree-legend{align-items:center;color:var(--rpi-muted);display:flex;flex-wrap:wrap;gap:5px 10px;grid-column:1/-1;font-size:9px}',
  '.rpi-tree-legend>strong{color:inherit;letter-spacing:.04em;text-transform:uppercase}',
  '.rpi-legend-item{align-items:center;display:inline-flex;gap:4px;white-space:nowrap}',
  '.rpi-legend-item>span{align-items:center;border:1px solid currentColor;border-radius:3px;display:inline-flex;font-weight:800;',
  'height:15px;justify-content:center;width:15px}.rpi-legend-item[data-role="blocker"]{color:var(--vscode-errorForeground,#f48771)}',
  '.rpi-legend-item[data-role="condition"]{color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-legend-item[data-role="assisted"],.rpi-legend-item[data-role="path"]{color:var(--vscode-symbolIcon-interfaceForeground,#75beff)}',
  '.rpi-legend-item[data-role="target"]{color:var(--vscode-charts-yellow,#facc15)}',
  '.rpi-candidate-select{align-items:center;display:flex;flex-wrap:wrap;gap:7px;grid-column:1/-1;max-width:100%;min-width:0}',
  '.rpi-candidate-select .rpi-context-badge{flex:0 1 auto;grid-row:auto}.rpi-candidate-select .rpi-select{flex:1 1 220px;max-width:min(360px,100%);width:100%}',
  '.rpi-page-choice-error{color:var(--vscode-errorForeground,#f48771);flex-basis:100%;overflow-wrap:anywhere}',
  '.rpi-page-paths{border:1px solid var(--rpi-border);border-left:3px solid var(--vscode-progressBar-background,#0e70c0);border-radius:4px;display:grid;gap:6px;max-width:100%;min-width:0;padding:7px 8px}',
  '.rpi-page-paths[data-state="verified"]{border-left-color:var(--vscode-testing-iconPassed,#73c991)}.rpi-page-paths[data-state="resumed"],.rpi-page-paths[data-state="transient"]{border-left-color:var(--vscode-charts-blue,#75beff)}.rpi-page-paths[data-state="attention"],.rpi-page-paths[data-state="unstable"]{border-left-color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-page-paths-heading{align-items:center;display:flex;flex-wrap:wrap;gap:6px;justify-content:space-between;min-width:0}',
  '.rpi-page-path-status,.rpi-page-path-item-status{color:var(--rpi-muted);font-size:9px;font-weight:700;letter-spacing:.04em}.rpi-page-paths[data-state="verified"]>.rpi-page-paths-heading>.rpi-page-path-status{color:var(--vscode-testing-iconPassed,#73c991)}.rpi-page-paths[data-state="resumed"]>.rpi-page-paths-heading>.rpi-page-path-status,.rpi-page-paths[data-state="transient"]>.rpi-page-paths-heading>.rpi-page-path-status{color:var(--vscode-charts-blue,#75beff)}.rpi-page-paths[data-state="unstable"]>.rpi-page-paths-heading>.rpi-page-path-status{color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-page-paths-help,.rpi-page-paths-empty{color:var(--rpi-muted);font-size:10px;margin:0;overflow-wrap:anywhere}',
  '.rpi-page-path-model-meta{border-bottom:1px solid var(--rpi-border);color:var(--rpi-muted);display:grid;font-size:9px;gap:3px;min-width:0;padding-bottom:6px}.rpi-page-path-model-meta>span{overflow-wrap:anywhere}.rpi-page-path-resume{justify-self:start;margin-top:2px}',
  '.rpi-page-path-list{display:grid;gap:4px;list-style:none;margin:0;max-height:min(34dvh,300px);min-width:0;overflow:auto;overscroll-behavior:contain;padding:0;scrollbar-gutter:stable}',
  '.rpi-page-path-item{border:1px solid var(--rpi-border);border-radius:3px;contain-intrinsic-size:0 72px;content-visibility:auto;min-width:0;overflow:hidden}.rpi-page-path-action{appearance:none;background:transparent;border:0;color:inherit;cursor:pointer;display:grid;font:inherit;gap:7px;grid-template-columns:minmax(0,1fr) auto auto;min-width:0;padding:6px 7px;text-align:left;width:100%}',
  '.rpi-page-path-action:hover:not(:disabled){background:var(--vscode-list-hoverBackground,rgba(90,93,94,.18))}.rpi-page-path-action:focus-visible{outline:1px solid var(--vscode-focusBorder,#007fd4);outline-offset:-2px}.rpi-page-path-action:disabled{cursor:default}',
  '.rpi-page-path-item[data-state="recommended"]{background:color-mix(in srgb,var(--vscode-progressBar-background,#0e70c0) 9%,transparent);border-color:var(--vscode-focusBorder,#007fd4)}',
  '.rpi-page-path-item[data-state="active"],.rpi-page-path-item[data-state="checking"],.rpi-page-path-item[data-state="queued"],.rpi-page-path-item[data-state="resumed"],.rpi-page-path-item[data-state="transient"],.rpi-page-path-item[data-state="user"]{border-color:var(--vscode-focusBorder,#007fd4)}.rpi-page-path-item[data-state="transient"]{background:color-mix(in srgb,var(--vscode-charts-blue,#75beff) 8%,transparent)}.rpi-page-path-item[data-state="resumed"]{background:color-mix(in srgb,var(--vscode-charts-blue,#75beff) 4%,transparent)}.rpi-page-path-item[data-state="verified"]{border-color:var(--vscode-testing-iconPassed,#73c991)}.rpi-page-path-item[data-state="unstable"]{border-color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-page-path-item[data-state="rejected"]{opacity:.64}.rpi-page-path-item[data-state="verified"] .rpi-page-path-item-status{color:var(--vscode-testing-iconPassed,#73c991)}.rpi-page-path-item[data-state="unstable"] .rpi-page-path-item-status{color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-page-path-copy{display:grid;gap:3px;min-width:0}.rpi-page-path-segments{align-items:center;display:flex;flex-wrap:wrap;font-family:var(--vscode-editor-font-family,monospace);font-size:10px;gap:3px;list-style:none;margin:0;min-width:0;padding:0}',
  '.rpi-page-path-segments>span{min-width:0;overflow-wrap:anywhere}.rpi-page-path-segments>span+span::before{color:var(--rpi-muted);content:"›";padding-right:3px}',
  '.rpi-page-path-meta{align-items:center;color:var(--rpi-muted);display:flex;flex-wrap:wrap;font-size:9px;gap:3px 8px;min-width:0}.rpi-page-path-meta>span{overflow-wrap:anywhere}',
  '.rpi-page-path-meta>code{background:color-mix(in srgb,var(--vscode-textCodeBlock-background,#222) 72%,transparent);border-radius:3px;max-width:100%;overflow:hidden;padding:1px 4px;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-page-path-apply{justify-self:end;min-width:68px}.rpi-page-path-item-status{align-self:center;white-space:nowrap}',
  '.rpi-route-explorer{border:1px solid var(--rpi-border);border-radius:4px;grid-column:1/-1;max-width:100%;min-width:0;overflow:hidden}',
  '.rpi-route-summary{align-items:center;cursor:pointer;display:grid;gap:7px;grid-template-columns:auto minmax(0,1fr);',
  'list-style:none;min-height:29px;padding:5px 7px}.rpi-route-summary::-webkit-details-marker{display:none}',
  '.rpi-route-summary::after{color:var(--rpi-muted);content:"▸";grid-column:3;grid-row:1}',
  '.rpi-route-explorer[open]>.rpi-route-summary::after{content:"▾"}',
  '.rpi-route-summary-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-route-browser{border-top:1px solid var(--rpi-border);display:grid;gap:6px;max-height:min(44dvh,430px);',
  'max-width:100%;min-width:0;overflow:auto;overflow-anchor:none;overscroll-behavior:contain;padding:7px;scrollbar-gutter:stable}',
  '.rpi-route-breadcrumbs,.rpi-route-folders,.rpi-route-list{display:grid;gap:4px;max-width:100%;min-width:0}',
  '.rpi-route-breadcrumbs{display:flex;flex-wrap:wrap}.rpi-route-folders{grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr))}',
  '.rpi-route-crumb,.rpi-route-folder,.rpi-route-item{background:transparent;border:1px solid var(--rpi-border);border-radius:3px;',
  'color:inherit;cursor:pointer;min-width:0;text-align:left}',
  '.rpi-route-crumb{max-width:100%;overflow:hidden;padding:2px 6px;text-overflow:ellipsis;white-space:nowrap}.rpi-route-folder{align-items:center;display:grid;gap:5px;grid-template-columns:auto minmax(0,1fr) auto;padding:5px 7px}.rpi-route-folder>span:nth-child(2){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-route-count,.rpi-route-state{color:var(--rpi-muted);font-size:9px;white-space:nowrap}',
  '.rpi-route-item{align-items:center;display:grid;gap:6px;grid-template-columns:13px minmax(0,1fr) auto;padding:5px 7px}',
  '.rpi-route-item:hover,.rpi-route-folder:hover,.rpi-route-crumb:hover{background:var(--vscode-list-hoverBackground,#2a2d2e)}',
  '.rpi-route-item.is-selected{border-color:var(--vscode-focusBorder,#007fd4);background:color-mix(in srgb,var(--vscode-focusBorder,#007fd4) 12%,transparent)}',
  '.rpi-route-item.is-pending{opacity:.72}.rpi-route-item.is-error{border-color:var(--vscode-errorForeground,#f48771)}.rpi-route-state[data-state="error"],.rpi-route-error{color:var(--vscode-errorForeground,#f48771)}.rpi-route-empty,.rpi-route-error{overflow-wrap:anywhere}.rpi-route-kind{color:var(--vscode-symbolIcon-interfaceForeground,#75beff);font-weight:800}',
  '.rpi-route-label{font-family:var(--vscode-editor-font-family,monospace);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rpi-route-list>.rpi-route-item{content-visibility:auto;contain-intrinsic-size:31px}.rpi-route-crumb,.rpi-route-folder,.rpi-route-item{touch-action:manipulation;-webkit-tap-highlight-color:transparent}',
  '@media (pointer:coarse){.rpi-route-crumb,.rpi-route-folder,.rpi-route-item{min-height:44px}}',
  '@media (max-width:480px){.rpi-route-browser{max-height:min(52dvh,430px);padding:6px}.rpi-route-item{grid-template-columns:13px minmax(0,1fr);}.rpi-route-item .rpi-route-state{grid-column:2;justify-self:start}.rpi-route-folders{grid-template-columns:1fr}}',
  '.rpi-workbench{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);max-width:100%;min-height:0;min-width:0;overflow:hidden}',
  '.rpi-pane{display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;min-width:0}',
  '.rpi-pane+.rpi-pane{border-left:1px solid var(--rpi-border)}',
  '.rpi-shell:is([data-dock="left"],[data-dock="right"]) .rpi-pane+.rpi-pane{border-left:0;border-top:1px solid var(--rpi-border)}',
  '.rpi-navigation-pane{overflow:hidden}.rpi-primary-panel{display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;min-width:0;overflow:hidden}',
  '.rpi-pane-heading{align-items:center;background:var(--vscode-sideBarSectionHeader-background,rgba(128,128,128,.08));',
  'border-bottom:1px solid var(--rpi-border);display:flex;flex-wrap:wrap;gap:7px;max-width:100%;min-height:31px;min-width:0;padding:4px 7px}',
  '.rpi-navigation-heading{padding:0 5px}.rpi-navigation-tabs{flex-basis:100%;flex-wrap:nowrap;overflow-anchor:none;overflow-x:auto;scrollbar-width:thin}',
  '.rpi-navigation-tabs>.rpi-tab{flex:1 0 110px;font-weight:650;text-align:center}',
  '.rpi-pane-title{font-size:11px;font-weight:650;letter-spacing:.04em;max-width:100%;overflow:hidden;text-overflow:ellipsis;text-transform:uppercase;white-space:nowrap}',
  '.rpi-search{min-width:80px;padding:2px 6px;width:100%}',
  '.rpi-components-body{display:grid;grid-template-rows:minmax(0,var(--rpi-primary-section-height,3fr)) 9px 28px minmax(0,2fr);',
  'min-height:0;min-width:0;overflow:hidden}',
  '.rpi-components-body[data-rpi-detail-collapsed="true"]{grid-template-rows:minmax(0,1fr) 9px 28px 0}',
  '.rpi-components-body[data-rpi-detail-collapsed="true"]>.rpi-tree-selection-detail{display:none}',
  '.rpi-components-body>.rpi-tree-scroll{grid-row:1}.rpi-components-body>.rpi-section-height-handle{grid-row:2}',
  '.rpi-components-body>.rpi-detail-section-accordion{grid-row:3}.rpi-components-body>.rpi-tree-selection-detail{grid-row:4}',
  '.rpi-tree-scroll{min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}',
  '.rpi-tree-selection-detail{border-top:1px solid var(--rpi-border);display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;min-width:0;overflow:hidden}',
  '.rpi-tree-selection-heading{align-items:center;background:var(--vscode-sideBarSectionHeader-background,rgba(128,128,128,.08));',
  'display:flex;gap:7px;min-height:27px;min-width:0;padding:3px 7px}.rpi-tree-selection-heading>.rpi-meta{margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-tree-selection-scroll{min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:6px 7px}',
  '.rpi-scenario-heading>.rpi-meta{margin-left:auto;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-scenario-scroll{min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}',
  '.rpi-scenario-table{border-collapse:separate;border-spacing:0;min-width:900px;width:100%}',
  '.rpi-scenario-table th{background:var(--vscode-sideBar-background,#252526);border-bottom:1px solid var(--rpi-border);',
  'color:var(--rpi-muted);font-size:9px;letter-spacing:.04em;padding:6px 7px;position:sticky;text-align:left;text-transform:uppercase;top:0;z-index:1}',
  '.rpi-scenario-table td{border-bottom:1px solid color-mix(in srgb,var(--rpi-border) 68%,transparent);padding:7px;vertical-align:top}',
  '.rpi-scenario-table tbody tr:hover{background:var(--vscode-list-hoverBackground,#2a2d2e)}',
  '.rpi-scenario-table tbody tr[data-reached="false"]{opacity:.66}',
  '.rpi-scenario-table tbody tr[data-lineage-blocked="true"]{background:color-mix(in srgb,var(--vscode-charts-yellow,#cca700) 7%,transparent)}',
  '.rpi-scenario-expression{display:grid;gap:3px;min-width:270px;max-width:460px}',
  '.rpi-scenario-lineage{align-items:stretch;display:flex;min-width:0}',
  '.rpi-scenario-lineage-guide{border-left:1px solid color-mix(in srgb,var(--vscode-charts-yellow,#cca700) 58%,var(--rpi-border));',
  'box-sizing:border-box;flex:0 0 13px;min-height:34px}',
  '.rpi-scenario-lineage-marker{color:var(--vscode-charts-yellow,#cca700);flex:0 0 17px;font-size:12px;font-weight:800;line-height:17px;text-align:center}',
  '.rpi-scenario-lineage-marker[data-root="true"]{font-size:8px}',
  '.rpi-scenario-lineage-content{display:grid;gap:2px;min-width:0}',
  '.rpi-scenario-lineage-summary{color:var(--rpi-muted);font-size:9px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-scenario-expression-button{background:transparent;border:0;color:inherit;cursor:pointer;font:11px/1.35 var(--vscode-editor-font-family,monospace);',
  'max-width:100%;overflow-wrap:anywhere;padding:0;text-align:left}.rpi-scenario-expression-button:disabled{cursor:default;opacity:1}',
  '.rpi-scenario-expression-button:not(:disabled):hover{text-decoration:underline}',
  '.rpi-scenario-branch{max-width:260px;min-width:130px;overflow-wrap:anywhere}',
  '.rpi-scenario-state{border:1px solid currentColor;border-radius:8px;display:inline-block;font-size:9px;font-weight:800;line-height:15px;',
  'min-width:38px;padding:0 5px;text-align:center}.rpi-scenario-state[data-enabled="true"]{color:var(--vscode-testing-iconPassed,#73c991)}',
  '.rpi-scenario-state[data-enabled="false"][data-reached="true"]{color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-scenario-state[data-reached="false"]{color:var(--rpi-muted)}',
  '.rpi-scenario-state[data-pending="true"]{color:var(--vscode-charts-blue,#75beff)}',
  '.rpi-scenario-table tr[data-lineage-blocked="true"] .rpi-scenario-state{color:var(--vscode-errorForeground,#f48771)}',
  '.rpi-scenario-mode{color:var(--rpi-muted);display:block;font-size:9px;margin-top:3px}',
  '.rpi-scenario-actions{min-width:176px;white-space:nowrap}.rpi-scenario-actions>.rpi-button{margin:0 3px 3px 0;min-width:42px}',
  '.rpi-detail-scroll{min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}',
  '.rpi-tree,.rpi-tree-group{box-sizing:border-box;list-style:none;margin:0;min-width:100%;width:max-content}',
  '.rpi-tree{padding:4px 0}',
  '.rpi-tree-group{padding-left:15px}',
  '.rpi-tree-row{align-items:center;background:transparent;border:0;box-sizing:border-box;color:inherit;cursor:default;display:flex;flex-wrap:nowrap;gap:5px;',
  'max-width:none;min-height:27px;min-width:360px;padding:2px 6px;text-align:left;width:100%}',
  '.rpi-tree-row:hover{background:var(--vscode-list-hoverBackground,#2a2d2e)}',
  '.rpi-tree-row[aria-selected="true"]{background:var(--vscode-list-activeSelectionBackground,#094771);color:var(--vscode-list-activeSelectionForeground,#fff)}',
  '.rpi-condition-row{background:color-mix(in srgb,var(--vscode-charts-yellow,#cca700) 6%,transparent);',
  'border-left:3px solid var(--vscode-charts-yellow,#cca700);cursor:pointer;padding-left:3px}',
  '.rpi-condition-row .rpi-component-icon{color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-blocker-row{background:color-mix(in srgb,var(--vscode-errorForeground,#f48771) 11%,transparent);',
  'border-left:3px solid var(--vscode-errorForeground,#f48771);cursor:pointer;padding-left:3px}',
  '.rpi-blocker-row .rpi-component-icon,.rpi-blocker-badge{color:var(--vscode-errorForeground,#f48771)}',
  '.rpi-blocker-row[data-resolution-kind="choice"]{background:color-mix(in srgb,var(--vscode-charts-yellow,#cca700) 7%,transparent);border-left-color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-blocker-row[data-resolution-kind="choice"] .rpi-component-icon,.rpi-blocker-row[data-resolution-kind="choice"] .rpi-blocker-badge{color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-blocker-row[data-resolution-kind="automatic"]{background:color-mix(in srgb,var(--vscode-symbolIcon-interfaceForeground,#75beff) 6%,transparent);border-left-color:var(--vscode-symbolIcon-interfaceForeground,#75beff)}',
  '.rpi-blocker-row[data-resolution-kind="automatic"] .rpi-component-icon,.rpi-blocker-row[data-resolution-kind="automatic"] .rpi-blocker-badge{color:var(--vscode-symbolIcon-interfaceForeground,#75beff)}',
  '.rpi-assisted-row{background:color-mix(in srgb,var(--vscode-symbolIcon-interfaceForeground,#75beff) 5%,transparent);',
  'border-left:3px solid var(--vscode-symbolIcon-interfaceForeground,#75beff);cursor:pointer;padding-left:3px}',
  '.rpi-assisted-row .rpi-component-icon,.rpi-assisted-badge{color:var(--vscode-symbolIcon-interfaceForeground,#75beff)}',
  '.rpi-path-probe-row{border-left:3px dashed var(--vscode-symbolIcon-interfaceForeground,#75beff);cursor:pointer;padding-left:3px}',
  '.rpi-path-probe-row .rpi-component-icon{color:var(--vscode-symbolIcon-interfaceForeground,#75beff)}',
  '.rpi-flow-outcome-row{background:color-mix(in srgb,var(--vscode-charts-yellow,#cca700) 6%,transparent);',
  'border-left:3px solid var(--vscode-charts-yellow,#cca700);cursor:pointer;padding-left:3px}',
  '.rpi-flow-outcome-row .rpi-component-icon,.rpi-flow-outcome-badge{color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-blocked-owner-row{background:color-mix(in srgb,var(--vscode-errorForeground,#f48771) 9%,transparent);',
  'border-left:2px dashed var(--vscode-errorForeground,#f48771);padding-left:4px}',
  '.rpi-blocked-owner-row .rpi-component-icon{color:var(--vscode-errorForeground,#f48771)}',
  '.rpi-export-badge{color:var(--vscode-charts-yellow,#cca700);font-weight:700}',
  '.rpi-current-export-row{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--vscode-charts-yellow,#facc15) 55%,transparent)}',
  '.rpi-overlay-row{border-left:2px solid var(--vscode-charts-purple,#b180d7);padding-left:4px}',
  '.rpi-overlay-row .rpi-component-icon{color:var(--vscode-charts-purple,#b180d7)}',
  '.rpi-wrapper-row .rpi-component-icon{color:var(--vscode-symbolIcon-interfaceForeground,#75beff)}',
  // Keep the disclosure control visibly larger than the component glyph while reserving the same
  // width on leaf rows. A 20px hit target remains usable in narrow docked Inspector layouts.
  '.rpi-twisty{align-items:center;border:1px solid transparent;border-radius:4px;box-sizing:border-box;display:inline-flex;flex:0 0 20px;',
  'font-size:14px;font-weight:800;height:20px;justify-content:center;line-height:1;text-align:center;width:20px}',
  '.rpi-twisty[data-expandable="true"]{color:var(--vscode-foreground,#ccc);cursor:pointer}',
  '.rpi-twisty[data-expandable="true"]:hover{background:var(--vscode-toolbar-hoverBackground,rgba(90,93,94,.31));border-color:var(--rpi-border)}',
  '.rpi-tree-row[aria-expanded="true"]>.rpi-twisty{color:var(--vscode-focusBorder,#75beff)}',
  '.rpi-component-icon{align-items:center;border:1px solid currentColor;border-radius:3px;color:var(--vscode-symbolIcon-classForeground,#ee9d28);',
  'display:inline-flex;flex:0 0 16px;font-size:9px;font-weight:800;height:16px;justify-content:center;width:16px}',
  '.rpi-blocker-row .rpi-component-icon{border-radius:50%}',
  '.rpi-node-role{border-radius:2px;color:var(--rpi-muted);flex:0 0 68px;font-size:7px;font-weight:800;letter-spacing:.04em;',
  'overflow:hidden;text-align:center;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-node-role[data-role="blocker"]{color:var(--vscode-errorForeground,#f48771)}',
  '.rpi-node-role[data-role="condition"]{color:var(--vscode-charts-yellow,#cca700)}',
  '.rpi-node-role[data-role="assisted"],.rpi-node-role[data-role="path"]{color:var(--vscode-symbolIcon-interfaceForeground,#75beff)}',
  '.rpi-node-role[data-role="target"]{color:var(--vscode-charts-yellow,#facc15)}',
  '.rpi-node-name{flex:0 1 320px;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-badge{border:1px solid currentColor;border-radius:8px;font-size:9px;line-height:14px;margin-left:3px;max-width:100%;opacity:.78;overflow:hidden;padding:0 5px;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-row-action{background:transparent;border:1px solid currentColor;border-radius:3px;color:inherit;cursor:pointer;',
  'font-size:9px;margin-left:auto;min-height:18px;padding:0 5px}.rpi-row-action:hover{background:rgba(127,127,127,.2)}',
  '.rpi-tree-condition-controls{align-items:center;display:inline-flex;flex:0 0 auto;gap:3px;margin-left:auto;min-width:0}',
  '.rpi-tree-condition-controls>.rpi-row-action{flex:0 0 auto;margin-left:0}',
  '.rpi-tree-condition-switch{min-width:38px;text-align:center}',
  '.rpi-tree-condition-switch[aria-checked="true"]{background:color-mix(in srgb,var(--vscode-button-background,#0e639c) 35%,transparent);',
  'border-color:var(--vscode-focusBorder,#007fd4)}',
  '.rpi-tree-condition-reset{max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-empty{color:var(--rpi-muted);padding:18px;text-align:center}',
  '.rpi-tabs{display:flex;flex:1 1 240px;flex-wrap:wrap;gap:1px;max-width:100%;min-width:0;overflow:hidden}',
  '.rpi-tab{background:transparent;border:0;border-bottom:2px solid transparent;color:var(--rpi-muted);cursor:pointer;max-width:100%;overflow:hidden;padding:4px 9px;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-tab[aria-selected="true"]{border-bottom-color:var(--vscode-focusBorder,#007fd4);color:inherit}',
  '.rpi-component-debugger{display:grid;gap:1px;max-width:100%;min-height:0;min-width:0}',
  '.rpi-component-debugger-panel{max-width:100%;min-height:0;min-width:0}',
  '.rpi-component-debugger-scope{padding:7px 9px 0}',
  '.rpi-detail-content{display:grid;gap:9px;max-width:100%;min-width:0;padding:9px}',
  '.rpi-meta{color:var(--rpi-muted);min-width:0;overflow-wrap:anywhere;white-space:normal}',
  '.rpi-json{background:var(--vscode-textCodeBlock-background,#2d2d2d);border:1px solid var(--rpi-border);border-radius:3px;',
  'color:inherit;font:11px/1.5 var(--vscode-editor-font-family,monospace);margin:0;max-width:100%;min-height:110px;min-width:0;overflow:auto;padding:7px;white-space:pre-wrap;width:100%}',
  'textarea.rpi-json{resize:vertical;width:100%}',
  '.rpi-actions{display:flex;flex-wrap:wrap;gap:6px}',
  '.rpi-error{color:var(--vscode-errorForeground,#f48771);min-width:0;overflow-wrap:anywhere}',
  '.rpi-note{color:var(--rpi-muted);font-size:11px;min-width:0;overflow-wrap:anywhere}',
  '.rpi-prop-choices{border:1px solid var(--rpi-border);border-radius:4px;display:grid;gap:7px;margin:0;min-width:0;padding:8px}',
  '.rpi-prop-choices>legend{color:var(--vscode-symbolIcon-interfaceForeground,#75beff);font-size:10px;font-weight:700;padding:0 4px}',
  '.rpi-prop-choice{align-items:center;display:grid;gap:7px;grid-template-columns:minmax(110px,1fr) minmax(120px,220px);min-width:0}',
  '.rpi-prop-choice-copy{display:grid;min-width:0}.rpi-prop-choice-copy>strong{font-family:var(--vscode-editor-font-family,monospace);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-prop-choice-copy>span{color:var(--rpi-muted);font-size:10px;overflow-wrap:anywhere}.rpi-prop-choice>.rpi-select{max-width:100%;width:100%}',
  '.rpi-blocker-editor{min-height:100%}.rpi-blocker-help{align-items:center;border-bottom:1px solid var(--rpi-border);',
  'display:grid;gap:9px;grid-template-columns:28px minmax(0,1fr);max-width:100%;min-width:0;padding:9px}',
  '.rpi-blocker-help[data-help-kind="blocking"]{background:color-mix(in srgb,var(--vscode-errorForeground,#f48771) 10%,transparent)}',
  '.rpi-blocker-help[data-help-kind="condition"]{background:color-mix(in srgb,var(--vscode-charts-yellow,#cca700) 8%,transparent)}',
  '.rpi-blocker-help[data-help-kind="flow-outcome"]{background:color-mix(in srgb,var(--vscode-charts-yellow,#cca700) 6%,transparent)}',
  '.rpi-blocker-help[data-help-kind="assisted"]{background:color-mix(in srgb,var(--vscode-symbolIcon-interfaceForeground,#75beff) 7%,transparent)}',
  '.rpi-blocker-help-icon{align-items:center;border:1px solid currentColor;border-radius:50%;display:flex;font-size:14px;',
  'font-weight:800;height:25px;justify-content:center;width:25px}.rpi-blocker-help-copy{display:grid;gap:2px;min-width:0}',
  '.rpi-blocker-help-copy>span{color:var(--rpi-muted);font-size:10px;overflow-wrap:anywhere}',
  '.rpi-wireframe-layer{color:#75beff;font:11px/1.35 var(--vscode-font-family,sans-serif);inset:0;overflow:hidden;',
  'pointer-events:none;position:fixed;z-index:2147483645}',
  '.rpi-wireframe-page-frame{border:1px solid color-mix(in srgb,#75beff 72%,transparent);inset:5px;position:absolute}',
  '.rpi-wireframe-page-label{background:rgba(15,23,42,.9);border:1px solid #75beff;border-radius:3px;',
  'bottom:6px;color:#dbeafe;font-weight:700;max-width:45vw;overflow:hidden;padding:2px 6px;position:absolute;',
  'right:6px;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-wireframe-box{background:transparent;border:1px dashed rgba(56,189,248,.48);',
  'min-height:1px;min-width:1px;pointer-events:none;position:absolute}',
  '.rpi-wireframe-box[data-current-file-export="true"]{background:rgba(250,204,21,.025);border-color:#facc15;border-style:solid}',
  '.rpi-wireframe-box[data-placeholder="true"]{background:repeating-linear-gradient(135deg,rgba(117,190,255,.08) 0 7px,',
  'rgba(117,190,255,.018) 7px 14px);border-color:#75beff;border-width:2px}',
  '.rpi-wireframe-box[data-placeholder="true"][data-resolution-kind="automatic"]{background:repeating-linear-gradient(135deg,rgba(117,190,255,.12) 0 7px,rgba(117,190,255,.025) 7px 14px);border-color:#75beff}',
  '.rpi-wireframe-box[data-placeholder="true"][data-resolution-kind="choice"]{background:repeating-linear-gradient(135deg,rgba(204,167,0,.13) 0 7px,rgba(204,167,0,.025) 7px 14px);border-color:#cca700}',
  '.rpi-wireframe-box[data-placeholder="true"][data-resolution-kind="error"]{background:repeating-linear-gradient(135deg,rgba(244,135,113,.12) 0 7px,rgba(244,135,113,.025) 7px 14px);border-color:#f48771}',
  '.rpi-wireframe-box-label{background:rgba(2,6,23,.72);border-radius:0 0 0 3px;color:#bae6fd;font-size:9px;',
  'max-width:min(220px,100%);opacity:.82;overflow:hidden;padding:1px 4px;position:absolute;right:0;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-wireframe-box[data-current-file-export="true"] .rpi-wireframe-box-label{color:#fef08a}',
  '.rpi-wireframe-box[data-placeholder="true"] .rpi-wireframe-box-label{color:#bae6fd;font-weight:700}',
  '.rpi-wireframe-box[data-placeholder="true"][data-resolution-kind="choice"] .rpi-wireframe-box-label{color:#fef08a}',
  '.rpi-wireframe-box[data-placeholder="true"][data-resolution-kind="error"] .rpi-wireframe-box-label{color:#fecaca}',
  '.rpi-wireframe-blocker{align-items:center;background:#1e3a5f;border:1px solid #bae6fd;border-radius:50%;',
  'box-shadow:0 2px 9px rgba(0,0,0,.42);color:#fff;cursor:pointer;display:flex;font-size:15px;font-weight:800;',
  'height:24px;justify-content:center;padding:0;pointer-events:auto;position:absolute;width:24px}',
  '.rpi-wireframe-blocker[data-resolution-kind="choice"]{background:#713f12;border-color:#fef08a}.rpi-wireframe-blocker[data-resolution-kind="error"]{background:#7f1d1d;border-color:#fecaca}',
  '.rpi-wireframe-blocker:hover{background:#075985}.rpi-wireframe-blocker[data-resolution-kind="choice"]:hover{background:#a16207}.rpi-wireframe-blocker[data-resolution-kind="error"]:hover{background:#b91c1c}',
  '.rpi-wireframe-blocker:focus-visible{outline:2px solid #fff;outline-offset:2px}',
  '.rpi-source-card{border:1px solid var(--rpi-border);border-radius:3px;display:grid;gap:5px;max-width:100%;min-width:0;padding:8px}',
  '.rpi-resizable-card{gap:0;grid-template-rows:auto 9px;min-height:56px;overflow:hidden;padding:0;position:relative}',
  '.rpi-resizable-card[data-rpi-resized="true"]{grid-template-rows:minmax(0,1fr) 9px}',
  '.rpi-resizable-card-content{display:grid;gap:5px;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;padding:8px;scrollbar-gutter:stable}',
  'details.rpi-resizable-card{grid-template-rows:auto auto 9px}',
  'details.rpi-resizable-card[data-rpi-resized="true"]{grid-template-rows:auto minmax(0,1fr) 9px}',
  'details.rpi-resizable-card>summary{cursor:pointer;margin:0;padding:8px}',
  'details.rpi-resizable-card:not([open])>.rpi-resizable-card-content,details.rpi-resizable-card:not([open])>.rpi-card-height-handle{display:none}',
  '.rpi-section-accordion{align-items:stretch;background:var(--vscode-sideBarSectionHeader-background,rgba(128,128,128,.08));',
  'border-bottom:1px solid var(--rpi-border);border-top:1px solid var(--rpi-border);display:grid;grid-template-columns:minmax(0,1fr);height:28px;min-height:28px;min-width:0}',
  '.rpi-section-accordion-toggle{align-items:center;background:transparent;border:0;color:inherit;cursor:pointer;',
  'display:inline-flex;font-size:10px;font-weight:650;gap:5px;max-width:100%;min-width:0;overflow:hidden;padding:0 8px;text-overflow:ellipsis;white-space:nowrap;width:100%}',
  '.rpi-section-accordion-toggle:hover{background:var(--vscode-list-hoverBackground,#2a2d2e)}',
  '.rpi-section-accordion-toggle>span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-section-accordion-toggle[data-rpi-collapsed="true"]{color:var(--vscode-focusBorder,#75beff)}',
  '.rpi-card-height-handle{background:transparent;cursor:ns-resize;display:block;height:9px;min-height:9px;position:relative;touch-action:none;user-select:none;width:100%;z-index:2}',
  '.rpi-section-height-handle,.rpi-shell-section-height-handle{background:transparent;cursor:ns-resize;display:block;height:9px;min-height:9px;position:relative;touch-action:none;user-select:none;width:100%;z-index:2}',
  '.rpi-card-height-handle::after,.rpi-section-height-handle::after,.rpi-shell-section-height-handle::after{background:var(--rpi-muted);border-radius:2px;content:"";',
  'height:2px;left:calc(50% - 24px);opacity:.35;position:absolute;transition:opacity 80ms linear;width:48px}',
  '.rpi-card-height-handle::after,.rpi-section-height-handle::after,.rpi-shell-section-height-handle::after{top:3px}',
  '.rpi-card-height-handle:hover::after,.rpi-card-height-handle:focus-visible::after,',
  '.rpi-section-height-handle:hover::after,.rpi-section-height-handle:focus-visible::after,',
  '.rpi-shell-section-height-handle:hover::after,.rpi-shell-section-height-handle:focus-visible::after{background:var(--vscode-focusBorder,#007fd4);opacity:1}',
  '.rpi-console{grid-template-rows:auto auto auto minmax(0,1fr);height:100%}',
  '.rpi-console-controls{display:grid;gap:6px;grid-template-columns:auto minmax(0,1fr) auto;max-width:100%;min-width:0}',
  '.rpi-console-list{border:1px solid var(--rpi-border);border-radius:3px;min-height:0;overflow:auto}',
  '.rpi-console-entry{border-left:3px solid var(--rpi-muted);display:grid;gap:4px;padding:7px 8px}',
  '.rpi-console-entry+.rpi-console-entry{border-top:1px solid var(--rpi-border)}',
  '.rpi-console-entry[data-level="error"]{border-left-color:var(--vscode-errorForeground,#f48771);background:rgba(244,135,113,.07)}',
  '.rpi-console-entry[data-level="warn"]{border-left-color:var(--vscode-charts-yellow,#cca700);background:rgba(204,167,0,.06)}',
  '.rpi-console-heading{align-items:center;display:flex;gap:7px;min-width:0}',
  '.rpi-console-level{font-size:9px;font-weight:750;letter-spacing:.05em}',
  '.rpi-console-time{color:var(--rpi-muted);font:10px var(--vscode-editor-font-family,monospace)}',
  '.rpi-console-meta{color:var(--rpi-muted);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.rpi-console-repeat{background:var(--vscode-badge-background,#4d4d4d);border-radius:8px;color:var(--vscode-badge-foreground,#fff);margin-left:auto;padding:0 5px}',
  '.rpi-console-message,.rpi-console-details pre{font:11px/1.45 var(--vscode-editor-font-family,monospace);margin:0;overflow-wrap:anywhere;white-space:pre-wrap}',
  '.rpi-console-details{color:var(--rpi-muted)}.rpi-console-details summary{cursor:pointer}.rpi-console-details pre{color:inherit;margin-top:6px}',
  '.rpi-shell[data-rpi-toolbar-collapsed="true"]>.rpi-toolbar,.rpi-shell[data-rpi-context-collapsed="true"]>.rpi-page-context{display:none}',
  '.rpi-shell[data-collapsed="true"] .rpi-page-context,.rpi-shell[data-collapsed="true"] .rpi-workbench,',
  '.rpi-shell[data-collapsed="true"] .rpi-resize-handle,.rpi-shell[data-collapsed="true"]>.rpi-shell-section-accordion,',
  '.rpi-shell[data-collapsed="true"]>.rpi-shell-section-height-handle{display:none}',
  '.rpi-shell[data-collapsed="true"]{grid-template-rows:auto!important}.rpi-shell[data-collapsed="true"]>.rpi-toolbar{grid-row:1}',
  '.rpi-resize-handle{background:transparent;border:0;display:block;position:absolute;touch-action:none;user-select:none;z-index:4}',
  '.rpi-resize-handle::after{background:var(--rpi-muted);border-radius:2px;content:"";opacity:.55;position:absolute}',
  '.rpi-resize-handle[data-edge="bottom"]{cursor:ns-resize;height:9px;left:0;right:0;top:-5px}',
  '.rpi-resize-handle[data-edge="bottom"]::after{bottom:2px;height:2px;left:calc(50% - 24px);width:48px}',
  '.rpi-resize-handle[data-edge="right"]{bottom:0;cursor:ew-resize;left:-5px;top:0;width:9px}',
  '.rpi-resize-handle[data-edge="right"]::after{height:48px;right:2px;top:calc(50% - 24px);width:2px}',
  '.rpi-resize-handle[data-edge="left"]{bottom:0;cursor:ew-resize;right:-5px;top:0;width:9px}',
  '.rpi-resize-handle[data-edge="left"]::after{height:48px;left:2px;top:calc(50% - 24px);width:2px}',
  '.rpi-resize-handle[data-edge="floating"]{border-bottom:2px solid var(--rpi-muted);border-right:2px solid var(--rpi-muted);',
  'bottom:2px;cursor:nwse-resize;height:14px;right:2px;width:14px}',
  '.rpi-resize-handle[data-edge="floating"]::after{display:none}',
  '.rpi-move-handle{background:transparent;border:0;color:var(--rpi-muted);cursor:move;display:none;font-size:16px;',
  'height:25px;line-height:20px;padding:0 4px;touch-action:none;user-select:none}',
  '.rpi-shell[data-dock="floating"] .rpi-move-handle{display:block}',
  // A wrapped toolbar or page breadcrumb can consume most of a short/narrow viewport. Retaining a
  // real workbench floor makes its own tree/detail scroller reachable; the shell becomes the final
  // vertical fallback only when both accordions and the workbench cannot fit together.
  '@media(max-height:560px){.rpi-shell{grid-template-rows:28px minmax(0,var(--rpi-toolbar-section-height,auto)) 9px 28px ',
  'minmax(0,var(--rpi-context-section-height,auto)) 9px minmax(0,1fr);',
  'overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}',
  '.rpi-workbench{min-height:0}}',
  '@container rpi-inspector (max-width:759px){.rpi-workbench{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr)}',
  '.rpi-pane+.rpi-pane{border-left:0;border-top:1px solid var(--rpi-border)}.rpi-select{max-width:min(180px,100%)}',
  '.rpi-friendly-status{grid-template-columns:26px minmax(0,1fr) auto}.rpi-friendly-status>.rpi-button{grid-column:1/-1;justify-self:start}',
  '.rpi-node-role{flex-basis:58px}',
  '.rpi-console-controls{grid-template-columns:minmax(0,1fr) auto}.rpi-console-controls>.rpi-select{grid-column:1/-1;max-width:100%;width:100%}}',
  '@container rpi-inspector (max-width:460px){.rpi-toolbar{align-items:stretch}.rpi-title{flex:1 1 100%;white-space:normal}',
  '.rpi-spacer{display:none}.rpi-toolbar>.rpi-button,.rpi-toolbar>.rpi-select{flex:1 1 auto}.rpi-page-context{gap:5px}',
  '.rpi-context-path,.rpi-context-detail{white-space:normal;overflow-wrap:anywhere}',
  '.rpi-friendly-status{grid-template-columns:24px minmax(0,1fr)}.rpi-friendly-status>.rpi-context-badge,.rpi-friendly-status>.rpi-button{grid-column:1/-1;justify-self:start}',
  '.rpi-candidate-select{align-items:stretch;display:grid;grid-template-columns:1fr}.rpi-candidate-select .rpi-context-badge{justify-self:start}',
  '.rpi-page-path-action{align-items:stretch;grid-template-columns:minmax(0,1fr)}.rpi-page-path-apply,.rpi-page-path-item-status{justify-self:start}',
  '.rpi-page-path-meta>code{white-space:normal;overflow-wrap:anywhere}',
  '.rpi-candidate-select .rpi-select{max-width:100%;width:100%}.rpi-pane-heading>.rpi-search,.rpi-pane-heading>.rpi-tabs{flex-basis:100%}',
  '.rpi-scenario-heading>.rpi-meta{flex-basis:100%;margin-left:0}',
  '.rpi-tree-group{padding-left:8px}.rpi-node-role{display:none}.rpi-row-action{flex:1 1 100%;margin-left:33px}.rpi-actions>.rpi-button{flex:1 1 auto}',
  '.rpi-prop-choice{grid-template-columns:minmax(0,1fr)}',
  '.rpi-neural-choice-block-heading,.rpi-neural-choice-heading,.rpi-neural-choice-footer,.rpi-neural-choice-path-heading,.rpi-neural-choice-path-recommendation,.rpi-neural-choice-path-alternatives li{align-items:stretch;display:grid;grid-template-columns:minmax(0,1fr)}.rpi-neural-choice-heading>span{max-width:100%;white-space:normal}',
  '.rpi-neural-choice-actions,.rpi-neural-choice-path-actions{justify-content:flex-start}',
  '.rpi-tree-condition-controls{flex:0 0 auto;margin-left:auto}.rpi-tree-condition-controls>.rpi-row-action{flex:0 0 auto;margin-left:0}',
  '.rpi-blocker-help{grid-template-columns:24px minmax(0,1fr);padding:7px}',
  '.rpi-console-controls{grid-template-columns:1fr}.rpi-console-controls>*{grid-column:1!important;max-width:100%;width:100%}}',
  '@media(max-width:460px){.rpi-shell{max-width:calc(100vw - 8px)}}',
].join('');

const PREVIEW_INSPECTOR_LAYOUT_MARGIN = 8;
const PREVIEW_INSPECTOR_LAYOUT_STEP = 16;
const previewInspectorLayoutModes = new Set(['bottom', 'left', 'right', 'floating']);

/** Retains visual controls across hot replacements and full VS Code webview restoration. */
const previewInspectorDevtoolsSessionState =
  previewInspectorSession.devtoolsState !== null &&
  typeof previewInspectorSession.devtoolsState === 'object' &&
  !Array.isArray(previewInspectorSession.devtoolsState)
    ? previewInspectorSession.devtoolsState
    : {};
previewInspectorSession.devtoolsState = previewInspectorDevtoolsSessionState;
previewInspectorDevtoolsSessionState.detailsTab =
  ['blocker', 'component', 'console'].includes(previewInspectorDevtoolsSessionState.detailsTab)
    ? previewInspectorDevtoolsSessionState.detailsTab
    : previewInspectorDevtoolsSessionState.activeTab === 'console' ? 'console' : 'component';
previewInspectorDevtoolsSessionState.collapsed = false;
previewInspectorDevtoolsSessionState.query =
  typeof previewInspectorDevtoolsSessionState.query === 'string'
    ? previewInspectorDevtoolsSessionState.query
    : '';
previewInspectorDevtoolsSessionState.navigationTab =
  ['scenarios', 'tree', 'details', 'console'].includes(
    previewInspectorDevtoolsSessionState.navigationTab,
  )
    ? previewInspectorDevtoolsSessionState.navigationTab
    : previewInspectorDevtoolsSessionState.navigationTab === 'components'
      ? 'tree'
      : previewInspectorDevtoolsSessionState.navigationTab === 'blockers'
        ? 'details'
        : 'scenarios';
Object.assign(
  previewInspectorDevtoolsSessionState,
  normalizePreviewInspectorLayout(previewInspectorDevtoolsSessionState),
);
previewInspectorDevtoolsSessionState.dock = 'bottom';

/** Returns a finite browser viewport even in synthetic or partially initialized webviews. */
function readPreviewInspectorViewport() {
  return {
    height: Number.isFinite(globalThis.innerHeight) ? Math.max(1, globalThis.innerHeight) : 800,
    width: Number.isFinite(globalThis.innerWidth) ? Math.max(1, globalThis.innerWidth) : 1280,
  };
}

/** Clamps an untrusted persisted dimension and applies an already bounded fallback. */
function clampPreviewInspectorLayoutValue(value, minimum, maximum, fallback) {
  const finiteValue = Number.isFinite(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, finiteValue));
}

/** Normalizes mode, dimensions, and floating coordinates against the current viewport. */
function normalizePreviewInspectorLayout(value, viewport = readPreviewInspectorViewport()) {
  const viewportWidth = Math.max(160, Number(viewport?.width) || 1280);
  const viewportHeight = Math.max(160, Number(viewport?.height) || 800);
  const maximumWidth = Math.max(144, viewportWidth - PREVIEW_INSPECTOR_LAYOUT_MARGIN * 2);
  const maximumHeight = Math.max(144, viewportHeight - PREVIEW_INSPECTOR_LAYOUT_MARGIN * 2);
  const minimumSideWidth = Math.min(300, maximumWidth);
  const minimumBottomHeight = Math.min(220, maximumHeight);
  const minimumFloatingWidth = Math.min(320, maximumWidth);
  const minimumFloatingHeight = Math.min(240, maximumHeight);
  const legacyDock = value?.dock === 'right' ? 'right' : 'bottom';
  const dock = previewInspectorLayoutModes.has(value?.dock) ? value.dock : legacyDock;
  const bottomHeight = clampPreviewInspectorLayoutValue(
    value?.bottomHeight,
    minimumBottomHeight,
    maximumHeight,
    Math.min(420, viewportHeight * 0.55, maximumHeight),
  );
  const sideWidth = clampPreviewInspectorLayoutValue(
    value?.sideWidth,
    minimumSideWidth,
    maximumWidth,
    Math.min(540, viewportWidth * 0.48, maximumWidth),
  );
  const floatingWidth = clampPreviewInspectorLayoutValue(
    value?.floatingWidth,
    minimumFloatingWidth,
    maximumWidth,
    Math.min(760, viewportWidth * 0.7, maximumWidth),
  );
  const floatingHeight = clampPreviewInspectorLayoutValue(
    value?.floatingHeight,
    minimumFloatingHeight,
    maximumHeight,
    Math.min(520, viewportHeight * 0.65, maximumHeight),
  );
  const maximumX = Math.max(
    PREVIEW_INSPECTOR_LAYOUT_MARGIN,
    viewportWidth - floatingWidth - PREVIEW_INSPECTOR_LAYOUT_MARGIN,
  );
  const maximumY = Math.max(
    PREVIEW_INSPECTOR_LAYOUT_MARGIN,
    viewportHeight - floatingHeight - PREVIEW_INSPECTOR_LAYOUT_MARGIN,
  );
  return {
    bottomHeight,
    dock,
    floatingHeight,
    floatingWidth,
    floatingX: clampPreviewInspectorLayoutValue(
      value?.floatingX,
      PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      maximumX,
      PREVIEW_INSPECTOR_LAYOUT_MARGIN,
    ),
    floatingY: clampPreviewInspectorLayoutValue(
      value?.floatingY,
      PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      maximumY,
      PREVIEW_INSPECTOR_LAYOUT_MARGIN,
    ),
    sideWidth,
  };
}

/** Converts normalized layout state into React inline styles for one fixed Shadow DOM shell. */
function createPreviewInspectorShellStyle(
  layout,
  collapsed,
  viewport = readPreviewInspectorViewport(),
) {
  if (collapsed) {
    const viewportWidth = Math.max(1, Number(viewport?.width) || 1280);
    const collapsedWidth = Math.max(
      1,
      Math.min(520, viewportWidth - PREVIEW_INSPECTOR_LAYOUT_MARGIN * 2),
    );
    return {
      bottom: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      height: 'auto',
      left: Math.max(
        0,
        viewportWidth - collapsedWidth - PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      ),
      maxWidth: 'none',
      minWidth: 0,
      right: 'auto',
      top: 'auto',
      transform: 'none',
      width: collapsedWidth,
    };
  }
  if (layout.dock === 'bottom') {
    return {
      bottom: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      height: layout.bottomHeight,
      left: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      right: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
    };
  }
  if (layout.dock === 'left') {
    return {
      bottom: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      left: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      top: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      width: layout.sideWidth,
    };
  }
  if (layout.dock === 'right') {
    return {
      bottom: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      right: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      top: PREVIEW_INSPECTOR_LAYOUT_MARGIN,
      width: layout.sideWidth,
    };
  }
  return {
    height: layout.floatingHeight,
    left: layout.floatingX,
    top: layout.floatingY,
    width: layout.floatingWidth,
  };
}

/** Applies a pointer/keyboard delta to a copied layout before viewport normalization. */
function resizePreviewInspectorLayout(layout, action, deltaX, deltaY) {
  if (action === 'move') {
    return normalizePreviewInspectorLayout({
      ...layout,
      floatingX: layout.floatingX + deltaX,
      floatingY: layout.floatingY + deltaY,
    });
  }
  if (layout.dock === 'bottom') {
    return normalizePreviewInspectorLayout({ ...layout, bottomHeight: layout.bottomHeight - deltaY });
  }
  if (layout.dock === 'left') {
    return normalizePreviewInspectorLayout({ ...layout, sideWidth: layout.sideWidth + deltaX });
  }
  if (layout.dock === 'right') {
    return normalizePreviewInspectorLayout({ ...layout, sideWidth: layout.sideWidth - deltaX });
  }
  return normalizePreviewInspectorLayout({
    ...layout,
    floatingHeight: layout.floatingHeight + deltaY,
    floatingWidth: layout.floatingWidth + deltaX,
  });
}

/** Owns React state while synchronously mirroring every update into the hot session object. */
function usePreviewInspectorLayout() {
  const initialLayout = React.useMemo(
    () => normalizePreviewInspectorLayout(previewInspectorDevtoolsSessionState),
    [],
  );
  const layoutRef = React.useRef(initialLayout);
  const [layout, setLayout] = React.useState(initialLayout);
  const updateLayout = React.useCallback((update) => {
    const candidate = typeof update === 'function' ? update(layoutRef.current) : update;
    const normalized = normalizePreviewInspectorLayout(candidate);
    layoutRef.current = normalized;
    Object.assign(previewInspectorDevtoolsSessionState, normalized);
    setLayout(normalized);
    return normalized;
  }, []);
  const persistLayout = React.useCallback(() => persistPreviewInspectorState(), []);
  React.useEffect(() => {
    const keepVisible = () => updateLayout((current) => current);
    globalThis.addEventListener?.('resize', keepVisible);
    return () => globalThis.removeEventListener?.('resize', keepVisible);
  }, [updateLayout]);
  return { layout, persistLayout, updateLayout };
}

/** Tracks one pointer gesture on its handle without installing document-global persistent state. */
function beginPreviewInspectorLayoutPointerGesture(
  event,
  action,
  layout,
  updateLayout,
  persistLayout,
) {
  if (event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  const move = (nextEvent) => {
    if (nextEvent.pointerId !== pointerId) return;
    updateLayout(
      resizePreviewInspectorLayout(
        layout,
        action,
        nextEvent.clientX - startX,
        nextEvent.clientY - startY,
      ),
    );
  };
  const finish = (nextEvent) => {
    if (nextEvent.pointerId !== pointerId) return;
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', finish);
    handle.removeEventListener('pointercancel', finish);
    try { handle.releasePointerCapture?.(pointerId); } catch { /* Capture may already be gone. */ }
    persistLayout();
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  try { handle.setPointerCapture?.(pointerId); } catch { /* Pointer capture is an enhancement. */ }
}

/** Maps arrow keys to the same bounded move/resize operation used by pointer gestures. */
function handlePreviewInspectorLayoutArrowKey(
  event,
  action,
  layout,
  updateLayout,
  persistLayout,
) {
  const deltas = {
    ArrowDown: [0, PREVIEW_INSPECTOR_LAYOUT_STEP],
    ArrowLeft: [-PREVIEW_INSPECTOR_LAYOUT_STEP, 0],
    ArrowRight: [PREVIEW_INSPECTOR_LAYOUT_STEP, 0],
    ArrowUp: [0, -PREVIEW_INSPECTOR_LAYOUT_STEP],
  };
  const delta = deltas[event.key];
  if (delta === undefined) return;
  event.preventDefault();
  updateLayout(resizePreviewInspectorLayout(layout, action, delta[0], delta[1]));
  persistLayout();
}

/** Renders the edge/corner separator used to resize the current expanded layout. */
function PreviewInspectorResizeHandle({ collapsed, layout, persistLayout, updateLayout }) {
  if (collapsed) return null;
  const orientation = layout.dock === 'floating'
    ? undefined
    : layout.dock === 'bottom'
      ? 'horizontal'
      : 'vertical';
  return React.createElement('div', {
    'aria-label': 'Resize React Page Inspector',
    'aria-orientation': orientation,
    className: 'rpi-resize-handle',
    'data-edge': layout.dock,
    onKeyDown: (event) => handlePreviewInspectorLayoutArrowKey(
      event,
      'resize',
      layout,
      updateLayout,
      persistLayout,
    ),
    onPointerDown: (event) => beginPreviewInspectorLayoutPointerGesture(
      event,
      'resize',
      layout,
      updateLayout,
      persistLayout,
    ),
    role: 'separator',
    tabIndex: 0,
    title: 'Drag or use arrow keys to resize the Inspector',
  });
}

/** Renders a keyboard-accessible drag handle only while the Inspector is floating. */
function PreviewInspectorMoveHandle({ layout, persistLayout, updateLayout }) {
  if (layout.dock !== 'floating') return null;
  return React.createElement(
    'button',
    {
      'aria-label': 'Move floating React Page Inspector',
      className: 'rpi-move-handle',
      onKeyDown: (event) => handlePreviewInspectorLayoutArrowKey(
        event,
        'move',
        layout,
        updateLayout,
        persistLayout,
      ),
      onPointerDown: (event) => beginPreviewInspectorLayoutPointerGesture(
        event,
        'move',
        layout,
        updateLayout,
        persistLayout,
      ),
      title: 'Drag or use arrow keys to move the Inspector',
      type: 'button',
    },
    '⠿',
  );
}

/** Renders an explicit placement selector instead of cycling through an implicit two-state toggle. */
function PreviewInspectorLayoutSelect({ layout, persistLayout, updateLayout }) {
  return React.createElement(
    'select',
    {
      'aria-label': 'Inspector position',
      className: 'rpi-select',
      onChange: (event) => {
        updateLayout({ ...layout, dock: event.target.value });
        persistLayout();
      },
      title: 'Choose a drawer edge or a movable floating Inspector',
      value: layout.dock,
    },
    React.createElement('option', { value: 'bottom' }, 'Bottom drawer'),
    React.createElement('option', { value: 'right' }, 'Right drawer'),
    React.createElement('option', { value: 'left' }, 'Left drawer'),
    React.createElement('option', { value: 'floating' }, 'Floating'),
  );
}
`;
}
