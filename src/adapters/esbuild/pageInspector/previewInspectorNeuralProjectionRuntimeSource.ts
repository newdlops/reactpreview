/** Generates the fixed numeric projection; no workspace values or learned scores are cached. */

/** Shares 1,024 lazy fixed weights while preserving the original arithmetic and model schema. */
export function createPreviewInspectorNeuralProjectionRuntimeSource(): string {
  return String.raw`
let previewInspectorNeuralResidualProjection;

/** Computes the immutable formula used by existing persisted version-four heads. */
function readPreviewInspectorNeuralResidualProjectionWeight(hiddenIndex, inputIndex) {
  const mixed = (
    Math.imul(hiddenIndex + 1, 0x45d9f3b) ^
    Math.imul(inputIndex + 3, 0x27d4eb2d)
  ) >>> 0;
  return (((mixed % 2001) / 1000) - 1) * 0.34;
}

/** Allocates fixed weights only on the first non-neutral inference or verified training update. */
function readPreviewInspectorNeuralResidualProjection() {
  if (previewInspectorNeuralResidualProjection === undefined) {
    previewInspectorNeuralResidualProjection = Object.freeze(Array.from(
      { length: PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HIDDEN_SIZE },
      (_, hiddenIndex) => Object.freeze(Array.from(
        { length: PREVIEW_INSPECTOR_NEURAL_RESIDUAL_INPUT_SIZE },
        (_, inputIndex) => readPreviewInspectorNeuralResidualProjectionWeight(hiddenIndex, inputIndex),
      )),
    ));
  }
  return previewInspectorNeuralResidualProjection;
}

/** Projects in the original input order so inference and SGD stay numerically identical. */
function projectPreviewInspectorNeuralResidualFeatures(vector) {
  const projection = readPreviewInspectorNeuralResidualProjection();
  return projection.map((weights, hiddenIndex) => {
    let activation = ((hiddenIndex % 3) - 1) * 0.025;
    for (let inputIndex = 0; inputIndex < vector.length; inputIndex += 1) {
      activation += vector[inputIndex] * weights[inputIndex];
    }
    return Math.tanh(activation);
  });
}
`;
}
