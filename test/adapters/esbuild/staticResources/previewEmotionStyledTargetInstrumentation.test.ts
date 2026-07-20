/** Verifies Emotion selector compatibility without loading a project's Babel or SWC plugins. */
import { describe, expect, it } from 'vitest';
import { createEmotionTargetReplacements } from '../../../../src/adapters/esbuild/staticResources/previewEmotionStyledTargetInstrumentation';
import { applyPreviewSourceReplacements } from '../../../../src/adapters/esbuild/staticResources/previewSourceReplacement';

const SOURCE_PATH = '/workspace/src/Card.tsx';

/** Applies discovered edits to make transform intent readable in assertions. */
function transform(source: string): string {
  return applyPreviewSourceReplacements(
    source,
    createEmotionTargetReplacements(SOURCE_PATH, source),
  );
}

describe('Emotion styled target instrumentation', () => {
  /** Adds identities to intrinsic and component template factories while preserving type arguments. */
  it('adds stable targets to tagged template factories', () => {
    const source = [
      `import styled from '@emotion/styled';`,
      'const Frame = styled.div<FrameProps>`display: flex;`;',
      'const Card = styled(Frame)`& > ${Frame} { color: red; }`;',
    ].join('\n');

    const first = transform(source);
    const second = transform(source);

    expect(first).toBe(second);
    expect(first).toMatch(/styled\("div", \{ target: "rpe[a-f0-9]{12}" \}\)<FrameProps>/u);
    expect(first).toMatch(/styled\(Frame, \{ target: "rpe[a-f0-9]{12}" \}\)`/u);
    expect(first).toContain('${Frame}');
  });

  /** Preserves authored options and supports object-style factory calls. */
  it('merges target identity into component options and intrinsic object styles', () => {
    const source = [
      `import emotionStyled from '@emotion/styled/macro';`,
      'const Box = emotionStyled.section({ display: "block" });',
      'const Video = emotionStyled(Player, { shouldForwardProp: allow })({ width: "100%" });',
    ].join('\n');
    const result = transform(source);

    expect(result).toMatch(/emotionStyled\("section", \{ target: "rpe[a-f0-9]{12}" \}\)\(\{/u);
    expect(result).toMatch(
      /emotionStyled\(Player, \{ \.\.\.\(\{ shouldForwardProp: allow \}\), target: "rpe[a-f0-9]{12}" \}\)\(\{/u,
    );
  });

  /** Leaves existing compiler output and unrelated styled-like objects untouched. */
  it('does not overwrite existing targets or transform unrelated bindings', () => {
    const source = [
      `import { default as makeStyled } from '@emotion/styled';`,
      'const Existing = makeStyled(Button, { target: "authored" })`color: red;`;',
      'const unrelated = styled.div`color: blue;`;',
    ].join('\n');

    expect(transform(source)).toBe(source);
  });
});
