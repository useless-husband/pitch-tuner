// 麥克風輸入：優先 AudioWorklet，退回 ScriptProcessor，再退回 AnalyserNode 輪詢。
import { createDetector, FrameAssembler, frameSizeFor } from './pitch.js';

export function micSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export async function listInputs() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === 'audioinput' && d.deviceId)
    .map((d, i) => ({ id: d.deviceId, label: d.label || `麥克風 ${i + 1}` }));
}

export class MicSession {
  /**
   * @param {(r:{freq:number|null, confidence:number, rms:number}) => void} onResult
   * @param {{mode?: 'worklet'|'script'|'analyser'}} [opts] mode 強制指定偵測方式（測試用）
   */
  constructor(onResult, opts = {}) {
    this.onResult = onResult;
    this.forceMode = opts.mode || null;
    this.config = {};
    this.mode = null;
    this.ctx = null;
    this.stream = null;
    this.nodes = [];
    this.timer = null;
  }

  async start(deviceId) {
    await this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const source = this.ctx.createMediaStreamSource(this.stream);
    const sink = this.ctx.createGain();
    sink.gain.value = 0; // 有些瀏覽器要求節點接到輸出才會處理，但不讓麥克風聲音播出來
    sink.connect(this.ctx.destination);
    this.nodes = [source, sink];

    const order = this.forceMode ? [this.forceMode] : ['worklet', 'script', 'analyser'];
    let lastError = null;
    for (const mode of order) {
      try {
        await this[`_start_${mode}`](source, sink);
        this.mode = mode;
        this.configure(this.config);
        return this.mode;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error('no capture mode available');
  }

  configure(partial) {
    this.config = { ...this.config, ...partial };
    if (this.workletNode) this.workletNode.port.postMessage({ type: 'config', config: this.config });
    if (this.detector) this.detector.configure(this.config);
  }

  async _start_worklet(source, sink) {
    if (!this.ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new Error('no worklet');
    await this.ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
    const node = new AudioWorkletNode(this.ctx, 'tuner-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit',
    });
    node.port.onmessage = (e) => this.onResult(e.data);
    source.connect(node);
    node.connect(sink);
    this.workletNode = node;
    this.nodes.push(node);
  }

  _makeLocalPipeline() {
    const size = frameSizeFor(this.ctx.sampleRate);
    this.detector = createDetector({ sampleRate: this.ctx.sampleRate });
    return new FrameAssembler(size, size / 4, (frame) => this.onResult(this.detector.detect(frame)));
  }

  async _start_script(source, sink) {
    if (!this.ctx.createScriptProcessor) throw new Error('no ScriptProcessor');
    const assembler = this._makeLocalPipeline();
    const node = this.ctx.createScriptProcessor(2048, 1, 1);
    node.onaudioprocess = (e) => assembler.push(e.inputBuffer.getChannelData(0));
    source.connect(node);
    node.connect(sink);
    this.nodes.push(node);
  }

  async _start_analyser(source) {
    const size = frameSizeFor(this.ctx.sampleRate);
    this._makeLocalPipeline();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = size;
    source.connect(analyser);
    this.nodes.push(analyser);
    const buf = new Float32Array(size);
    const poll = () => {
      analyser.getFloatTimeDomainData(buf);
      this.onResult(this.detector.detect(buf));
      this.timer = setTimeout(poll, 40);
    };
    poll();
  }

  async stop() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.workletNode) this.workletNode.port.onmessage = null;
    this.workletNode = null;
    this.detector = null;
    for (const n of this.nodes) {
      try { n.disconnect(); } catch { /* 已中斷 */ }
    }
    this.nodes = [];
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) {
      try { await this.ctx.close(); } catch { /* 已關閉 */ }
    }
    this.ctx = null;
    this.mode = null;
  }
}
