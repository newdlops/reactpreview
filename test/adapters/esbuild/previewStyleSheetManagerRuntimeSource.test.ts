import { describe, expect, it } from 'vitest';
import { createPreviewStyleSheetManagerRuntimeSource } from '../../../src/adapters/esbuild/previewStyleSheetManagerRuntimeSource';

describe('createPreviewStyleSheetManagerRuntimeSource', () => {
  it('uses a detached, owned head target and removes that exact target on disposal', () => {
    const source = createPreviewStyleSheetManagerRuntimeSource();
    expect(source).toContain('data-react-preview-styled-components-target');
    expect(source).toContain('document.head.appendChild(ownedTarget)');
    expect(source).toContain('target?.parentNode !== null && target?.parentNode !== undefined');
    expect(source).toContain('target.parentNode.removeChild(target)');
    expect(source).not.toContain('document.head.querySelector');
  });

  it('keeps setup false above authored/static selection and bounds style commit telemetry', () => {
    const source = createPreviewStyleSheetManagerRuntimeSource();
    expect(source).toContain(
      "if (configuration === false) return { disabled: true, precedence: 'setup' }",
    );
    expect(source).toContain('Math.min(ruleCount, 1000000)');
    expect(source).toContain("'styled-components-style-commit'");
    expect(source).toContain("'unsafe-setup-accessor'");
  });
});
