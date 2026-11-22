/**
 * Genera un archivo WAV real (16-bit PCM mono, 44.1 kHz, ~3 segundos)
 * con sonido de sirena comunitaria de emergencia en bucle continuo.
 * Libre de derechos y sin dependencias externas.
 */
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const DURATION_SECONDS = 3;
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const NUM_SAMPLES = SAMPLE_RATE * DURATION_SECONDS;

const outputPath = path.resolve(__dirname, '../assets/sounds/panic_siren.wav');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const dataSize = NUM_SAMPLES * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
const buffer = Buffer.alloc(44 + dataSize);

// RIFF header
buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write('WAVE', 8);

// fmt subchunk
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16); // PCM chunk size
buffer.writeUInt16LE(1, 20); // AudioFormat = 1 (PCM)
buffer.writeUInt16LE(NUM_CHANNELS, 22);
buffer.writeUInt32LE(SAMPLE_RATE, 24);
buffer.writeUInt32LE(SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8), 28); // ByteRate
buffer.writeUInt16LE(NUM_CHANNELS * (BITS_PER_SAMPLE / 8), 32); // BlockAlign
buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);

// data subchunk
buffer.write('data', 36);
buffer.writeUInt32LE(dataSize, 40);

// Generador de sirena de 3 ciclos completos (1 ciclo por segundo -> bucle limpio)
// Barrido de frecuencia 780 Hz <-> 1480 Hz con armónico para máxima claridad en altavoz móvil.
let phase = 0;
const cyclesPerClip = 3;
const minFreq = 780;
const maxFreq = 1480;
const amplitude = 0.88;

for (let i = 0; i < NUM_SAMPLES; i++) {
  const t = i / SAMPLE_RATE;
  // Onda sinusoidal de modulación (0..1) que empieza y termina en el mismo punto
  const mod = 0.5 - 0.5 * Math.cos(2 * Math.PI * (cyclesPerClip / DURATION_SECONDS) * t);
  const freq = minFreq + (maxFreq - minFreq) * mod;

  phase += (2 * Math.PI * freq) / SAMPLE_RATE;
  if (phase > 2 * Math.PI) {
    phase -= 2 * Math.PI;
  }

  // Fundamental + 2do y 3er armónico suave para penetración acústica en altavoz pequeño
  const rawSample =
    0.72 * Math.sin(phase) +
    0.2 * Math.sin(2 * phase) +
    0.08 * Math.sin(3 * phase);

  // Pequeño fade de 5ms en extremos para evitar clics al hacer loop
  const fadeSamples = Math.floor(SAMPLE_RATE * 0.005);
  let envelope = 1.0;
  if (i < fadeSamples) {
    envelope = i / fadeSamples;
  } else if (i > NUM_SAMPLES - fadeSamples) {
    envelope = (NUM_SAMPLES - i) / fadeSamples;
  }

  const clamped = Math.max(-1, Math.min(1, rawSample * amplitude * envelope));
  const int16Sample = Math.round(clamped * 32767);
  buffer.writeInt16LE(int16Sample, 44 + i * 2);
}

fs.writeFileSync(outputPath, buffer);
console.log(
  `[generate-siren] Generado ${outputPath} (${(buffer.length / 1024).toFixed(1)} KB, ${DURATION_SECONDS}s, 16-bit PCM)`
);
