// AudioWorklet：在音訊執行緒內累積取樣框並執行 YIN / MPM，再把結果傳回主執行緒。
import { createDetector, FrameAssembler, frameSizeFor } from './pitch.js';

class TunerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const size = frameSizeFor(sampleRate);
    this.detector = createDetector({ sampleRate });
    this.assembler = new FrameAssembler(size, size / 4, (frame) => {
      this.port.postMessage(this.detector.detect(frame));
    });
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'config') this.detector.configure(e.data.config);
    };
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.assembler.push(channel);
    return true;
  }
}

registerProcessor('tuner-processor', TunerProcessor);
