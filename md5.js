/*
 * Incremental MD5 (RFC 1321), dependency-free.
 * Usage: const hasher = new Md5(); hasher.update(bytes); hasher.hex();
 */
(function (global) {
  'use strict';

  const SHIFTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i += 1) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  }

  function rotateLeft(value, count) {
    return ((value << count) | (value >>> (32 - count))) >>> 0;
  }

  class Md5 {
    constructor() {
      this.state = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
      this.buffer = new Uint8Array(64);
      this.bufferLength = 0;
      this.totalLength = 0;
    }

    update(data) {
      if (typeof data === 'string') {
        data = new TextEncoder().encode(data);
      } else if (!(data instanceof Uint8Array)) {
        data = new Uint8Array(data);
      }

      let offset = 0;
      this.totalLength += data.length;

      if (this.bufferLength > 0) {
        const take = Math.min(64 - this.bufferLength, data.length);
        this.buffer.set(data.subarray(0, take), this.bufferLength);
        this.bufferLength += take;
        offset += take;
        if (this.bufferLength === 64) {
          this.processBlock(this.buffer, 0, this.state);
          this.bufferLength = 0;
        }
      }

      while (offset + 64 <= data.length) {
        this.processBlock(data, offset, this.state);
        offset += 64;
      }

      if (offset < data.length) {
        this.buffer.set(data.subarray(offset), 0);
        this.bufferLength = data.length - offset;
      }
      return this;
    }

    digest() {
      const state = this.state.slice();
      const remainder = this.bufferLength;
      const padLength = remainder < 56 ? 56 - remainder : 120 - remainder;
      const tail = new Uint8Array(remainder + padLength + 8);

      tail.set(this.buffer.subarray(0, remainder), 0);
      tail[remainder] = 0x80;

      const bitsLow = (this.totalLength * 8) >>> 0;
      const bitsHigh = Math.floor(this.totalLength / 536870912) >>> 0;
      const lengthOffset = tail.length - 8;
      tail[lengthOffset] = bitsLow & 0xff;
      tail[lengthOffset + 1] = (bitsLow >>> 8) & 0xff;
      tail[lengthOffset + 2] = (bitsLow >>> 16) & 0xff;
      tail[lengthOffset + 3] = (bitsLow >>> 24) & 0xff;
      tail[lengthOffset + 4] = bitsHigh & 0xff;
      tail[lengthOffset + 5] = (bitsHigh >>> 8) & 0xff;
      tail[lengthOffset + 6] = (bitsHigh >>> 16) & 0xff;
      tail[lengthOffset + 7] = (bitsHigh >>> 24) & 0xff;

      for (let offset = 0; offset < tail.length; offset += 64) {
        this.processBlock(tail, offset, state);
      }
      return state;
    }

    hex() {
      const state = this.digest();
      let output = '';
      for (let i = 0; i < 4; i += 1) {
        const word = state[i];
        output += (word & 0xff).toString(16).padStart(2, '0');
        output += ((word >>> 8) & 0xff).toString(16).padStart(2, '0');
        output += ((word >>> 16) & 0xff).toString(16).padStart(2, '0');
        output += ((word >>> 24) & 0xff).toString(16).padStart(2, '0');
      }
      return output;
    }

    processBlock(bytes, offset, state) {
      const words = new Uint32Array(16);
      for (let i = 0; i < 16; i += 1) {
        const j = offset + i * 4;
        words[i] = (
          bytes[j]
          | (bytes[j + 1] << 8)
          | (bytes[j + 2] << 16)
          | (bytes[j + 3] << 24)
        ) >>> 0;
      }

      let a = state[0];
      let b = state[1];
      let c = state[2];
      let d = state[3];

      for (let i = 0; i < 64; i += 1) {
        let f;
        let g;
        if (i < 16) {
          f = (b & c) | (~b & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          f = b ^ c ^ d;
          g = (3 * i + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * i) % 16;
        }

        const previousD = d;
        d = c;
        c = b;
        b = (b + rotateLeft((a + f + K[i] + words[g]) >>> 0, SHIFTS[i])) >>> 0;
        a = previousD;
      }

      state[0] = (state[0] + a) >>> 0;
      state[1] = (state[1] + b) >>> 0;
      state[2] = (state[2] + c) >>> 0;
      state[3] = (state[3] + d) >>> 0;
    }
  }

  global.Md5 = Md5;
}(typeof globalThis !== 'undefined' ? globalThis : self));
