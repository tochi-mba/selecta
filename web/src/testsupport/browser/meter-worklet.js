// Real AudioWorkletProcessor: not a Web Audio mock or a promise of physical output.
class SelectaQAMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blocks = 0;
    this.peak = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    for (let channel = 0; channel < output.length; channel++) {
      const dest = output[channel];
      const source = input[Math.min(channel, input.length - 1)];
      for (let i = 0; i < dest.length; i++) {
        const sample = source ? source[i] || 0 : 0;
        dest[i] = sample;
        this.peak = Math.max(this.peak, Math.abs(sample));
      }
    }
    this.blocks += 1;
    if (this.blocks % 8 === 0) {
      this.port.postMessage({ blocks: this.blocks, peak: this.peak, frames: this.blocks * 128 });
    }
    return true;
  }
}
registerProcessor('selecta-qa-meter', SelectaQAMeter);
