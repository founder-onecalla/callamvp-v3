/**
 * Audio conversion utilities
 *
 * Handles:
 * - mulaw (G.711 μ-law) ↔ PCM16 conversion
 * - Sample rate conversion (8kHz ↔ 24kHz)
 *
 * Telnyx uses: mulaw, 8kHz, mono
 * OpenAI uses: PCM16, 24kHz, mono
 */

// μ-law decoding table (8-bit mulaw to 16-bit linear)
const MULAW_DECODE_TABLE = new Int16Array([
  -32124, -31100, -30076, -29052, -28028, -27004, -25980, -24956,
  -23932, -22908, -21884, -20860, -19836, -18812, -17788, -16764,
  -15996, -15484, -14972, -14460, -13948, -13436, -12924, -12412,
  -11900, -11388, -10876, -10364, -9852, -9340, -8828, -8316,
  -7932, -7676, -7420, -7164, -6908, -6652, -6396, -6140,
  -5884, -5628, -5372, -5116, -4860, -4604, -4348, -4092,
  -3900, -3772, -3644, -3516, -3388, -3260, -3132, -3004,
  -2876, -2748, -2620, -2492, -2364, -2236, -2108, -1980,
  -1884, -1820, -1756, -1692, -1628, -1564, -1500, -1436,
  -1372, -1308, -1244, -1180, -1116, -1052, -988, -924,
  -876, -844, -812, -780, -748, -716, -684, -652,
  -620, -588, -556, -524, -492, -460, -428, -396,
  -372, -356, -340, -324, -308, -292, -276, -260,
  -244, -228, -212, -196, -180, -164, -148, -132,
  -120, -112, -104, -96, -88, -80, -72, -64,
  -56, -48, -40, -32, -24, -16, -8, 0,
  32124, 31100, 30076, 29052, 28028, 27004, 25980, 24956,
  23932, 22908, 21884, 20860, 19836, 18812, 17788, 16764,
  15996, 15484, 14972, 14460, 13948, 13436, 12924, 12412,
  11900, 11388, 10876, 10364, 9852, 9340, 8828, 8316,
  7932, 7676, 7420, 7164, 6908, 6652, 6396, 6140,
  5884, 5628, 5372, 5116, 4860, 4604, 4348, 4092,
  3900, 3772, 3644, 3516, 3388, 3260, 3132, 3004,
  2876, 2748, 2620, 2492, 2364, 2236, 2108, 1980,
  1884, 1820, 1756, 1692, 1628, 1564, 1500, 1436,
  1372, 1308, 1244, 1180, 1116, 1052, 988, 924,
  876, 844, 812, 780, 748, 716, 684, 652,
  620, 588, 556, 524, 492, 460, 428, 396,
  372, 356, 340, 324, 308, 292, 276, 260,
  244, 228, 212, 196, 180, 164, 148, 132,
  120, 112, 104, 96, 88, 80, 72, 64,
  56, 48, 40, 32, 24, 16, 8, 0
])

// μ-law encoding constants
const MULAW_MAX = 0x1FFF
const MULAW_BIAS = 33

export class AudioConverter {
  /**
   * Convert mulaw audio to PCM16
   */
  mulawToPcm16(mulaw: Uint8Array): Int16Array {
    const pcm16 = new Int16Array(mulaw.length)
    for (let i = 0; i < mulaw.length; i++) {
      pcm16[i] = MULAW_DECODE_TABLE[mulaw[i]]
    }
    return pcm16
  }

  /**
   * Convert PCM16 audio to mulaw
   */
  pcm16ToMulaw(pcm16: Int16Array): Uint8Array {
    const mulaw = new Uint8Array(pcm16.length)
    for (let i = 0; i < pcm16.length; i++) {
      mulaw[i] = this.linearToMulaw(pcm16[i])
    }
    return mulaw
  }

  /**
   * Convert a single PCM16 sample to mulaw
   */
  private linearToMulaw(sample: number): number {
    // Clamp and get sign
    const sign = sample < 0 ? 0x80 : 0x00
    if (sign) sample = -sample

    // Add bias and clamp
    sample = Math.min(sample + MULAW_BIAS, MULAW_MAX)

    // Find segment and quantize
    let exponent = 7
    let mantissa = sample >> 4

    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {
      // Find the segment number
    }

    mantissa = (sample >> (exponent + 3)) & 0x0F
    const mulawByte = ~(sign | (exponent << 4) | mantissa)

    return mulawByte & 0xFF
  }

  /**
   * Resample audio from one sample rate to another
   * Uses linear interpolation for simplicity
   */
  resample(input: Int16Array, fromRate: number, toRate: number): Int16Array {
    if (fromRate === toRate) return input

    const ratio = fromRate / toRate
    const outputLength = Math.ceil(input.length / ratio)
    const output = new Int16Array(outputLength)

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio
      const srcIndexFloor = Math.floor(srcIndex)
      const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1)
      const fraction = srcIndex - srcIndexFloor

      // Linear interpolation
      output[i] = Math.round(
        input[srcIndexFloor] * (1 - fraction) + input[srcIndexCeil] * fraction
      )
    }

    return output
  }

  /**
   * Convert PCM16 Int16Array to base64 string
   */
  pcm16ToBase64(pcm16: Int16Array): string {
    const bytes = new Uint8Array(pcm16.buffer)
    return btoa(String.fromCharCode(...bytes))
  }

  /**
   * Convert base64 string to PCM16 Int16Array
   */
  base64ToPcm16(base64: string): Int16Array {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    return new Int16Array(bytes.buffer)
  }
}
