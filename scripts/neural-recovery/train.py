"""Train/compare local recovery MLPs on owned executions; NumPy is training-only, never shipped.

Run with: uv run --no-env-file --with numpy==2.3.3 python scripts/neural-recovery/train.py <corpus-dir>
No downloads, user-project access, GPU, telemetry, or runtime-model modification occur here.
"""
import argparse
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import time

# Keep this optional offline job from monopolizing the user's desktop.
os.environ["OPENBLAS_NUM_THREADS"] = "2"
os.environ["VECLIB_MAXIMUM_THREADS"] = "2"
os.environ["OMP_NUM_THREADS"] = "2"
import numpy as np  # noqa: E402


def sigmoid(value):
    """Evaluate a bounded logistic output without overflow warnings."""
    return 1 / (1 + np.exp(-np.clip(value, -20, 20)))


def predict(features, weights):
    """Run the same two ReLU layers and logistic output as the generated browser runtime."""
    hidden = features
    for index in range(0, len(weights), 2):
        hidden = hidden @ weights[index] + weights[index + 1]
        hidden = np.maximum(hidden, 0) if index < 4 else sigmoid(hidden)
    return hidden[:, 0]


def loss(labels, scores):
    """Return unweighted held-out binary cross entropy, including genuinely ambiguous cases."""
    bounded = np.clip(scores, 1e-7, 1 - 1e-7)
    return float(-np.mean(labels * np.log(bounded) + (1 - labels) * np.log1p(-bounded)))


def group_rows(rows):
    """Keep complete intervention portfolios together when measuring time-to-first-solution."""
    groups = {}
    for index, row in enumerate(rows):
        groups.setdefault(row["group"], []).append(index)
    return groups


def training_pairs(rows):
    """Prefer an observed success, then materially cheaper successful work inside the same portfolio."""
    pairs = []
    for indices in group_rows(rows).values():
        for offset, left in enumerate(indices):
            for right in indices[offset + 1:]:
                first, second = rows[left], rows[right]
                if first["label"] != second["label"]:
                    pairs.append((left, right, 1.0) if first["label"] else (right, left, 1.0))
                elif first["label"] and abs(first["cost"] - second["cost"]) >= 2:
                    weight = min(0.2, abs(first["cost"] - second["cost"]) / 100)
                    pairs.append((left, right, weight) if first["cost"] < second["cost"] else (right, left, weight))
    return np.array(pairs, dtype=np.float64).reshape((-1, 3))


def ranking_metrics(rows, scores, domains):
    """Apply the production abstention gate and compare with the unchanged deterministic baseline."""
    families = {}
    for indices in group_rows(rows).values():
        family = rows[indices[0]]["family"]
        result = families.setdefault(family, {"cases": 0, "solvable": 0,
            "baselineFirst": 0, "modelFirst": 0, "baselineAttempts": 0,
            "modelAttempts": 0, "priorApplied": 0, "baselineCost": 0.0, "modelCost": 0.0})
        baseline = sorted(indices, key=lambda index: (rows[index]["rank"], index))
        utilities = {index: max(0, float(scores[index]) - min(0.075, rows[index]["cost"] * 0.0015)) for index in indices}
        ranked = sorted(indices, key=lambda index: -utilities[index])
        bounds = domains[family]
        supported = all(all(low - 0.12 <= value <= high + 0.12
            for value, low, high in zip(rows[index]["features"][96:], bounds["minimum"], bounds["maximum"]))
            for index in indices)
        first, second = ranked[:2]
        clear = scores[first] - scores[second] >= 0.2
        cheaper = scores[first] >= 0.9 and scores[second] >= 0.9 and utilities[first] - utilities[second] >= 0.02
        applied = supported and scores[first] >= 0.8 and (clear or cheaper)
        # Retry states are separately observed portfolios, not fabricated successful continuations.
        selected = ranked[0] if applied else baseline[0]
        ordering = [selected] + [index for index in baseline if index != selected]
        result["cases"] += 1
        result["priorApplied"] += int(applied)
        result["baselineFirst"] += rows[baseline[0]]["label"]
        result["modelFirst"] += rows[selected]["label"]
        if any(rows[index]["label"] for index in indices):
            result["solvable"] += 1
            result["baselineAttempts"] += next(i + 1 for i, index in enumerate(baseline) if rows[index]["label"])
            result["modelAttempts"] += next(i + 1 for i, index in enumerate(ordering) if rows[index]["label"])
        for name, order in [("baselineCost", baseline), ("modelCost", ordering)]:
            for index in order:
                result[name] += rows[index]["cost"]
                if rows[index]["label"]:
                    break
    total = {key: sum(item[key] for item in families.values()) for key in next(iter(families.values()))}
    total["baselineFirstAttemptPct"] = total["baselineFirst"] / total["cases"] * 100
    total["modelFirstAttemptPct"] = total["modelFirst"] / total["cases"] * 100
    total["baselineMeanAttempts"] = total["baselineAttempts"] / max(1, total["solvable"])
    total["modelMeanAttempts"] = total["modelAttempts"] / max(1, total["solvable"])
    total["families"] = families
    return total


def quantize(weights):
    """Quantize weights and biases together per layer; evaluate these exact shipped values."""
    arrays, encoded, scales = [], [], []
    for index in range(0, len(weights), 2):
        flat = np.concatenate([weights[index].ravel(), weights[index + 1].ravel()])
        scale = float(max(float(np.max(np.abs(flat))) / 127, 1e-9))
        quantized = np.clip(np.rint(flat / scale), -127, 127).astype(np.int8)
        restored = quantized.astype(np.float32) * np.float32(scale)
        split = weights[index].size
        arrays.extend([restored[:split].reshape(weights[index].shape), restored[split:].reshape(weights[index + 1].shape)])
        encoded.append(quantized.tobytes())
        scales.append(scale)
    return arrays, b"".join(encoded), scales


def fit(train_x, train_y, sample_weights, pairs, validation_x, validation_y, width, epochs, deadline):
    """Optimize cost-weighted BCE plus within-portfolio ranking; keep unweighted held-out early stopping."""
    random = np.random.default_rng(20260907 + width)
    dimensions = [train_x.shape[1], width, width // 4, 1]
    weights = []
    for previous, following in zip(dimensions[:-1], dimensions[1:]):
        weights.extend([(random.standard_normal((previous, following)) * math.sqrt(2 / previous)).astype(np.float32),
                        np.zeros((following,), dtype=np.float32)])
    momentum = [np.zeros_like(array) for array in weights]
    velocity = [np.zeros_like(array) for array in weights]
    best, best_loss, best_epoch, stale, step = None, math.inf, 0, 0, 0
    history = []
    for epoch in range(1, epochs + 1):
        if time.monotonic() > deadline:
            raise RuntimeError("Local training time budget exceeded; no unvalidated artifact will be emitted.")
        learning_rate = 0.0015 * (0.25 + 0.75 * (1 + math.cos(math.pi * (epoch - 1) / epochs)) / 2)
        indices = random.permutation(len(train_x))
        for start in range(0, len(indices), 256):
            batch = indices[start:start + 256]
            paired = pairs[random.integers(len(pairs), size=min(128, len(batch)))]
            left, right = paired[:, 0].astype(np.int64), paired[:, 1].astype(np.int64)
            combined = np.concatenate([batch, left, right])
            x = train_x[combined]
            first = np.maximum(x @ weights[0] + weights[1], 0)
            second = np.maximum(first @ weights[2] + weights[3], 0)
            logits = second @ weights[4] + weights[5]
            output = sigmoid(logits)
            delta_output = np.zeros_like(output)
            delta_output[:len(batch), 0] = (output[:len(batch), 0] - train_y[batch]) * sample_weights[batch] / len(batch)
            pair_start = len(batch)
            pair_end = pair_start + len(paired)
            pair_delta = (sigmoid(logits[pair_start:pair_end, 0] - logits[pair_end:, 0]) - 1) * paired[:, 2] * 0.15 / len(paired)
            delta_output[pair_start:pair_end, 0] = pair_delta
            delta_output[pair_end:, 0] = -pair_delta
            delta_second = (delta_output @ weights[4].T) * (second > 0)
            delta_first = (delta_second @ weights[2].T) * (first > 0)
            gradients = [x.T @ delta_first, delta_first.sum(axis=0),
                         first.T @ delta_second, delta_second.sum(axis=0),
                         second.T @ delta_output, delta_output.sum(axis=0)]
            step += 1
            for index, gradient in enumerate(gradients):
                if index % 2 == 0:
                    gradient += weights[index] * 0.00002
                np.clip(gradient, -5, 5, out=gradient)
                momentum[index] *= 0.9
                momentum[index] += gradient * 0.1
                velocity[index] *= 0.999
                velocity[index] += gradient * gradient * 0.001
                weights[index] -= learning_rate * (momentum[index] / (1 - 0.9 ** step)) / (
                    np.sqrt(velocity[index] / (1 - 0.999 ** step)) + 1e-8)
                np.clip(weights[index], -12, 12, out=weights[index])
        validation_loss = loss(validation_y, predict(validation_x, weights))
        if not math.isfinite(validation_loss):
            raise RuntimeError("Non-finite validation loss; refusing to export weights.")
        history.append({"epoch": epoch, "validationLoss": validation_loss})
        if validation_loss < best_loss - 0.0001:
            best = [array.copy() for array in weights]
            best_loss, best_epoch, stale = validation_loss, epoch, 0
        else:
            stale += 1
        if epoch == 1 or epoch % 5 == 0:
            print(json.dumps({"width": width, "epoch": epoch, "validationLoss": validation_loss}), flush=True)
        if stale >= 10:
            break
    return best, {"dimensions": dimensions, "epochsRun": len(history), "selectedEpoch": best_epoch,
                  "updates": step, "history": history}


def export_artifact(destination, weights, scales, dimensions, domains):
    """Emit a non-executable TS constant; the caller installs it with apply_patch after review."""
    checksum = 2166136261
    for byte in weights:
        checksum = ((checksum ^ byte) * 16777619) & 0xffffffff
    digest = hashlib.sha256(weights).hexdigest()
    artifact = {"format": 2, "id": "recovery-prior-v2-" + digest[:12], "dimensions": dimensions,
                "scales": scales, "checksum": checksum, "parameters": len(weights), "domains": domains,
                "weights": base64.b64encode(weights).decode("ascii")}
    header = "/** Owned, held-out-validated int8 recovery MLP. See docs/neural-pretraining.md for provenance. */\n"
    content = header + "export const previewInspectorRecoveryPriorArtifact = {\n"
    for key, value in artifact.items():
        if key == "weights":
            chunks = [value[index:index + 1024] for index in range(0, len(value), 1024)]
            content += "  weights:\n    " + " +\n    ".join(json.dumps(chunk) for chunk in chunks) + ",\n"
        else:
            content += "  " + key + ": " + json.dumps(value) + ",\n"
    content += "} as const;\n"
    (destination / "model-artifact.ts").write_text(content)
    return {key: value for key, value in artifact.items() if key != "weights"} | {
        "weightsSha256": digest, "encodedBytes": len(artifact["weights"]), "artifactBytes": len(content.encode())}


def main():
    """Compare capacity using validation only, then evaluate the selected quantized artifact once."""
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--max-seconds", type=int, default=1800)
    args = parser.parse_args()
    if not 10 <= args.epochs <= 200 or not 60 <= args.max_seconds <= 7200:
        parser.error("epochs must be 10..200; max-seconds must be 60..7200")
    started = time.monotonic()
    data = json.loads((args.directory / "corpus.json").read_text())
    if any(data["manifest"]["crossSplitFeatureOverlaps"].values()):
        raise RuntimeError("Cross-split feature leakage detected.")
    train, validation = data["splits"]["train"], data["splits"]["validation"]
    train_x = np.array([row["features"] for row in train], dtype=np.float32)
    train_y = np.array([row["label"] for row in train], dtype=np.float32)
    validation_x = np.array([row["features"] for row in validation], dtype=np.float32)
    validation_y = np.array([row["label"] for row in validation], dtype=np.float32)
    if train_x.shape[1] != 144:
        raise RuntimeError("V2 requires the matching causal-context encoder.")
    sample_weights = np.array([1 + (1 - row["label"]) * min(2, row["cost"] / 25) for row in train], dtype=np.float32)
    pairs = training_pairs(train)
    if len(pairs) == 0:
        raise RuntimeError("No independently executed alternatives for pairwise recovery learning.")
    domains = {}
    for family in sorted({row["family"] for row in train}):
        values = train_x[[index for index, row in enumerate(train) if row["family"] == family], 96:]
        domains[family] = {"minimum": values.min(axis=0).tolist(), "maximum": values.max(axis=0).tolist()}
    candidates = []
    for width in [128, 256, 384]:
        weights, history = fit(train_x, train_y, sample_weights, pairs, validation_x, validation_y, width,
                               args.epochs, started + args.max_seconds)
        restored, encoded, scales = quantize(weights)
        scores = predict(validation_x, restored)
        metrics = ranking_metrics(validation, scores, domains)
        candidate = {**history, "parameters": len(encoded), "validation": metrics,
                     "quantizedValidationLoss": loss(validation_y, scores)}
        print(json.dumps({key: value for key, value in candidate.items() if key != "history"}), flush=True)
        candidates.append((candidate, restored, encoded, scales, weights))
    chosen = min(candidates, key=lambda entry: (-entry[0]["validation"]["modelFirst"],
                 entry[0]["validation"]["modelCost"], entry[0]["validation"]["modelAttempts"],
                 entry[0]["parameters"], entry[0]["quantizedValidationLoss"]))
    report, restored, encoded, scales, original = chosen
    test = data["splits"]["test"]
    test_x = np.array([row["features"] for row in test], dtype=np.float32)
    test_y = np.array([row["label"] for row in test], dtype=np.float32)
    test_scores = predict(test_x, restored)
    final_metrics = ranking_metrics(test, test_scores, domains)
    if final_metrics["modelFirst"] <= final_metrics["baselineFirst"] or any(
        family["modelFirst"] < family["baselineFirst"] for family in final_metrics["families"].values()
    ):
        raise RuntimeError("Held-out recovery failed the no-regression release gate; refusing to export.")
    artifact = export_artifact(args.directory, encoded, scales, report["dimensions"], domains)
    np.savez_compressed(args.directory / "selected-checkpoint.npz", *original)
    result = {"format": 2, "numpy": np.__version__, "threads": 2, "seed": 20260907,
              "objective": "cost-weighted BCE + 0.15 pairwise logistic; successful cost-tie pairs weighted <=0.2",
              "trainingPairs": len(pairs),
              "seconds": time.monotonic() - started, "corpus": data["manifest"],
              "selectionRule": "validation first-attempt success, structural cost, attempts, smaller capacity, loss; test only after selection",
              "candidates": [entry[0] for entry in candidates], "artifact": artifact,
              "test": final_metrics, "testLoss": loss(test_y, test_scores),
              "testScoreMaxQuantizationError": float(np.max(np.abs(predict(test_x, original) - test_scores)))}
    (args.directory / "training-report.json").write_text(json.dumps(result) + "\n")
    # Runtime parity vectors are independent of the training implementation's matmul arithmetic.
    selected = np.linspace(0, len(test) - 1, 128, dtype=int)
    parity = [{"features": test[index]["features"], "score": float(test_scores[index])} for index in selected]
    (args.directory / "runtime-parity.json").write_text(json.dumps(parity) + "\n")
    print(json.dumps({"artifact": artifact, "test": final_metrics, "seconds": result["seconds"]}), flush=True)


if __name__ == "__main__":
    main()
