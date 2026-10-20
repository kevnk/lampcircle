function wavBlob(buffer: AudioBuffer): Blob {
  const channel = buffer.getChannelData(0);
  const pcm = new DataView(new ArrayBuffer(44 + channel.length * 2));
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) pcm.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  pcm.setUint32(4, 36 + channel.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  pcm.setUint32(16, 16, true);
  pcm.setUint16(20, 1, true);
  pcm.setUint16(22, 1, true);
  pcm.setUint32(24, buffer.sampleRate, true);
  pcm.setUint32(28, buffer.sampleRate * 2, true);
  pcm.setUint16(32, 2, true);
  pcm.setUint16(34, 16, true);
  write(36, 'data');
  pcm.setUint32(40, channel.length * 2, true);
  for (let i = 0; i < channel.length; i++) {
    const sample = Math.max(-1, Math.min(1, channel[i]));
    pcm.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([pcm.buffer], { type: 'audio/wav' });
}

export async function generateDemoTrack(): Promise<Blob> {
  const duration = 60;
  const sampleRate = 44100;
  const bpm = 120;
  const beat = 60 / bpm;
  const context = new OfflineAudioContext(1, Math.ceil(sampleRate * duration), sampleRate);
  const chords = [
    [130.81, 164.81, 196, 261.63],
    [174.61, 220, 261.63, 349.23],
    [196, 246.94, 293.66, 392],
    [130.81, 164.81, 196, 261.63],
  ];

  for (let index = 0; index * beat < duration; index++) {
    const time = index * beat;
    const click = context.createOscillator();
    const clickGain = context.createGain();
    click.frequency.value = index % 4 === 0 ? 180 : 120;
    clickGain.gain.setValueAtTime(index % 4 === 0 ? 0.7 : 0.35, time);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    click.connect(clickGain);
    clickGain.connect(context.destination);
    click.start(time);
    click.stop(time + 0.08);
  }

  const bars = Math.floor(duration / (beat * 4));
  for (let bar = 0; bar < bars; bar++) {
    const time = bar * beat * 4;
    for (const frequency of chords[bar % chords.length]) {
      const pad = context.createOscillator();
      const padGain = context.createGain();
      pad.type = 'sine';
      pad.frequency.value = frequency;
      padGain.gain.setValueAtTime(0.001, time);
      padGain.gain.linearRampToValueAtTime(0.04, time + 0.4);
      padGain.gain.linearRampToValueAtTime(0.001, time + beat * 4);
      pad.connect(padGain);
      padGain.connect(context.destination);
      pad.start(time);
      pad.stop(time + beat * 4);
    }
  }

  return wavBlob(await context.startRendering());
}

export async function createClickTrack(bpm: number, duration: number): Promise<AudioBuffer> {
  const sampleRate = 44100;
  const audioContext = new OfflineAudioContext(1, sampleRate * duration, sampleRate);
  
  const clickDuration = 0.05;
  const beatInterval = 60 / bpm;
  
  for (let time = 0; time < duration; time += beatInterval) {
    const osc = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    osc.frequency.value = 1000;
    osc.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    gainNode.gain.setValueAtTime(0.3, time);
    gainNode.gain.exponentialRampToValueAtTime(0.01, time + clickDuration);
    
    osc.start(time);
    osc.stop(time + clickDuration);
  }
  
  return await audioContext.startRendering();
}
