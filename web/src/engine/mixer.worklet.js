/* A tiny bounded two-input stereo sum. All decoding, envelope scheduling, effects,
 * I/O and state mutation live outside process(). No allocations in the audio callback. */
class SelectaBrowserMixer extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const left = output[0];
    const right = output[1] || left;
    const first = inputs[0] || [];
    const second = inputs[1] || [];
    const aLeft = first[0], aRight = first[1] || aLeft;
    const bLeft = second[0], bRight = second[1] || bLeft;
    for (let i = 0; i < left.length; i++) {
      const l = (aLeft ? aLeft[i] : 0) + (bLeft ? bLeft[i] : 0);
      const r = (aRight ? aRight[i] : 0) + (bRight ? bRight[i] : 0);
      // Bound output; DynamicsCompressorNode after this also provides peak safety.
      left[i] = Math.max(-1, Math.min(1, l));
      if (right !== left) right[i] = Math.max(-1, Math.min(1, r));
    }
    return true;
  }
}
registerProcessor('selecta-browser-mixer-v1', SelectaBrowserMixer);
