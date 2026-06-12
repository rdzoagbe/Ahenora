'use strict';

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function utf8ToBytes(input) {
  const text = String(input ?? '');

  if (typeof TextEncoder !== 'undefined') {
    return Array.from(new TextEncoder().encode(text));
  }

  const encoded = unescape(encodeURIComponent(text));
  const bytes = new Array(encoded.length);
  for (let i = 0; i < encoded.length; i += 1) {
    bytes[i] = encoded.charCodeAt(i);
  }
  return bytes;
}

function bytesToUtf8(bytes) {
  const array = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);

  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(array);
  }

  let binary = '';
  for (let i = 0; i < array.length; i += 1) {
    binary += String.fromCharCode(array[i]);
  }
  return decodeURIComponent(escape(binary));
}

function base64ToBytes(input) {
  const clean = String(input ?? '').replace(/[\r\n\s]/g, '');

  if (typeof atob === 'function') {
    const binary = atob(clean);
    const bytes = new Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  let buffer = 0;
  let bits = 0;
  const output = [];

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (char === '=') break;

    const value = BASE64_CHARS.indexOf(char);
    if (value < 0 || value > 63) continue;

    buffer = (buffer << 6) | value;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }

  return output;
}

function bytesToBase64(bytes) {
  const array = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
  let binary = '';
  for (let i = 0; i < array.length; i += 1) {
    binary += String.fromCharCode(array[i]);
  }

  if (typeof btoa === 'function') return btoa(binary);

  let output = '';
  let i = 0;
  while (i < binary.length) {
    const chr1 = binary.charCodeAt(i++);
    const chr2 = binary.charCodeAt(i++);
    const chr3 = binary.charCodeAt(i++);

    const enc1 = chr1 >> 2;
    const enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
    let enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
    let enc4 = chr3 & 63;

    if (Number.isNaN(chr2)) {
      enc3 = 64;
      enc4 = 64;
    } else if (Number.isNaN(chr3)) {
      enc4 = 64;
    }

    output += BASE64_CHARS.charAt(enc1) + BASE64_CHARS.charAt(enc2) + BASE64_CHARS.charAt(enc3) + BASE64_CHARS.charAt(enc4);
  }

  return output;
}

class BufferShim extends Uint8Array {
  static from(input, encoding) {
    if (input instanceof Uint8Array || Array.isArray(input)) {
      return new BufferShim(input);
    }

    const normalizedEncoding = String(encoding || 'utf8').toLowerCase();
    if (normalizedEncoding === 'base64') {
      return new BufferShim(base64ToBytes(input));
    }

    return new BufferShim(utf8ToBytes(input));
  }

  toString(encoding) {
    const normalizedEncoding = String(encoding || 'utf8').toLowerCase();
    if (normalizedEncoding === 'base64') {
      return bytesToBase64(this);
    }
    return bytesToUtf8(this);
  }
}

module.exports = {
  Buffer: BufferShim,
};
