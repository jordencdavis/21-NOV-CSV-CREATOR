export interface ProtocolLimits {
  maxFields: number;
  maxKeyLen: number;
  maxValLen: number;
  maxFrameLen: number;
  txQueueDepth: number;
  frameTimeoutMs: number;
  maxNodeId: number;
}

export const DEFAULT_LIMITS: ProtocolLimits = {
  maxFields: 16,
  maxKeyLen: 15,
  maxValLen: 31,
  maxFrameLen: 896,
  txQueueDepth: 3,
  frameTimeoutMs: 500,
  maxNodeId: 15,
};

export interface SafeCsvField {
  key: string;
  value: string;
}

export type PacketTypeCode = 'S' | 'C' | 'A' | 'H' | string;

export interface SafeCsvPacket {
  version: number;
  src: number;
  dest: number; // 0 = SAFECSV_NODE_ALL
  type: PacketTypeCode;
  seq: number; // 0..65535 (16-bit rollover)
  ts: string; // 64-bit timestamp stored as string to preserve full uint64 precision
  ttl: number;
  fields: SafeCsvField[];
}

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface EncodeResult {
  ok: boolean;
  frame: string;
  body: string;
  crcHex: string;
  crcValue: number;
  byteLength: number;
  issues: ValidationIssue[];
}

export type ParseErrorCode =
  | 'OK'
  | 'ERR_EMPTY'
  | 'ERR_NO_START_DELIMITER'
  | 'ERR_NO_END_DELIMITER'
  | 'ERR_FRAME_OVERFLOW'
  | 'ERR_MISSING_CRC'
  | 'ERR_CRC_MISMATCH'
  | 'ERR_BAD_HEADER'
  | 'ERR_NODE_ID_RANGE'
  | 'ERR_FIELD_COUNT_LIMIT'
  | 'ERR_COUNT_MISMATCH'
  | 'ERR_BAD_FIELD_SYNTAX'
  | 'ERR_KEY_LENGTH'
  | 'ERR_VALUE_LENGTH';

export interface ParseResult {
  ok: boolean;
  code: ParseErrorCode;
  message: string;
  packet: SafeCsvPacket | null;
  expectedCrcHex: string;
  receivedCrcHex: string;
  byteLength: number;
}

export interface ReplayNodeEntry {
  src: number;
  initialized: boolean;
  lastSeq: number;
  bitmap: number; // 32-bit unsigned window
  sessionId: string | null;
  acceptedCount: number;
  duplicateCount: number;
  rebootCount: number;
}

export type ReplayDecision =
  | 'ACCEPTED_FIRST'
  | 'ACCEPTED_NEW'
  | 'ACCEPTED_OUT_OF_ORDER'
  | 'ACCEPTED_REBOOT_DETECTED'
  | 'DROPPED_DUPLICATE'
  | 'DROPPED_TOO_OLD';

const RESERVED_CHARS_REGEX = /[,=*<>\r\n]/;

/**
 * Computes CRC-16/CCITT-FALSE:
 * Polynomial: 0x1021, Initial: 0xFFFF, RefIn: false, RefOut: false, XorOut: 0x0000
 */
export function computeCrc16CcittFalse(input: string): number {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= (input.charCodeAt(i) & 0xff) << 8;
    for (let bit = 0; bit < 8; bit++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc & 0xffff;
}

export function formatCrcHex(crc: number): string {
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

export function validatePacket(
  packet: SafeCsvPacket,
  limits: ProtocolLimits
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!Number.isInteger(packet.version) || packet.version < 1 || packet.version > 255) {
    issues.push({
      field: 'version',
      message: 'VERSION must be an integer between 1 and 255.',
      severity: 'error',
    });
  }

  if (!Number.isInteger(packet.src) || packet.src < 1 || packet.src > limits.maxNodeId) {
    issues.push({
      field: 'src',
      message: `SRC must be between 1 and ${limits.maxNodeId} (SAFECSV_MAX_NODE_ID).`,
      severity: 'error',
    });
  }

  if (!Number.isInteger(packet.dest) || packet.dest < 0 || packet.dest > limits.maxNodeId) {
    issues.push({
      field: 'dest',
      message: `DEST must be 0 (Broadcast) or 1..${limits.maxNodeId}.`,
      severity: 'error',
    });
  }

  if (!packet.type || packet.type.length !== 1 || RESERVED_CHARS_REGEX.test(packet.type)) {
    issues.push({
      field: 'type',
      message: 'TYPE must be a single valid character (e.g. S, C, A).',
      severity: 'error',
    });
  }

  if (!Number.isInteger(packet.seq) || packet.seq < 0 || packet.seq > 65535) {
    issues.push({
      field: 'seq',
      message: 'SEQ must be a 16-bit unsigned integer (0..65535).',
      severity: 'error',
    });
  }

  if (!/^\d+$/.test(packet.ts)) {
    issues.push({
      field: 'ts',
      message: 'TS must be an unsigned 64-bit integer timestamp.',
      severity: 'error',
    });
  }

  if (!Number.isInteger(packet.ttl) || packet.ttl < 0 || packet.ttl > 255) {
    issues.push({
      field: 'ttl',
      message: 'TTL must be an integer between 0 and 255.',
      severity: 'error',
    });
  }

  if (packet.ttl === 0) {
    issues.push({
      field: 'ttl',
      message: 'TTL is 0: receiving node will process locally and will not forward.',
      severity: 'warning',
    });
  }

  if (packet.fields.length > limits.maxFields) {
    issues.push({
      field: 'fields',
      message: `Field count (${packet.fields.length}) exceeds SAFECSV_MAX_FIELDS (${limits.maxFields}).`,
      severity: 'error',
    });
  }

  const seenKeys = new Set<string>();
  packet.fields.forEach((f, idx) => {
    const key = f.key.trim();
    if (!key) {
      issues.push({
        field: `field_${idx}`,
        message: `Field #${idx + 1} key cannot be empty.`,
        severity: 'error',
      });
    } else {
      if (key.length > limits.maxKeyLen) {
        issues.push({
          field: `field_${idx}`,
          message: `Key "${key}" (${key.length} chars) exceeds SAFECSV_MAX_KEY_LEN (${limits.maxKeyLen}).`,
          severity: 'error',
        });
      }
      if (RESERVED_CHARS_REGEX.test(key)) {
        issues.push({
          field: `field_${idx}`,
          message: `Key "${key}" contains a reserved delimiter (, = * < >).`,
          severity: 'error',
        });
      }
      if (seenKeys.has(key)) {
        issues.push({
          field: `field_${idx}`,
          message: `Duplicate key "${key}" in payload.`,
          severity: 'warning',
        });
      }
      seenKeys.add(key);
    }

    if (f.value.length > limits.maxValLen) {
      issues.push({
        field: `field_${idx}`,
        message: `Value for "${key || `#${idx + 1}`}" (${f.value.length} chars) exceeds SAFECSV_MAX_VAL_LEN (${limits.maxValLen}).`,
        severity: 'error',
      });
    }
    if (RESERVED_CHARS_REGEX.test(f.value)) {
      issues.push({
        field: `field_${idx}`,
        message: `Value "${f.value}" contains a reserved delimiter (, = * < >).`,
        severity: 'error',
      });
    }
  });

  return issues;
}

export function encodeFrame(
  packet: SafeCsvPacket,
  limits: ProtocolLimits = DEFAULT_LIMITS
): EncodeResult {
  const issues = validatePacket(packet, limits);
  const count = packet.fields.length;
  const header = `${packet.version},${packet.src},${packet.dest},${packet.type},${packet.seq},${packet.ts},${packet.ttl},${count}`;
  const payloadParts = packet.fields.map((f) => `${f.key}=${f.value}`);
  const body = count > 0 ? `${header},${payloadParts.join(',')}` : header;
  const crcValue = computeCrc16CcittFalse(body);
  const crcHex = formatCrcHex(crcValue);
  const frame = `<${body}*${crcHex}>`;
  const byteLength = frame.length;

  if (byteLength > limits.maxFrameLen) {
    issues.push({
      field: 'frame',
      message: `Encoded frame (${byteLength} bytes) exceeds SAFECSV_MAX_FRAME_LEN (${limits.maxFrameLen} bytes).`,
      severity: 'error',
    });
  }

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    frame,
    body,
    crcHex,
    crcValue,
    byteLength,
    issues,
  };
}

export function parseFrame(
  rawInput: string,
  limits: ProtocolLimits = DEFAULT_LIMITS
): ParseResult {
  const raw = rawInput.trim();
  const byteLength = raw.length;

  if (!raw) {
    return {
      ok: false,
      code: 'ERR_EMPTY',
      message: 'Empty input stream.',
      packet: null,
      expectedCrcHex: '----',
      receivedCrcHex: '----',
      byteLength,
    };
  }

  if (!raw.startsWith('<')) {
    return {
      ok: false,
      code: 'ERR_NO_START_DELIMITER',
      message: 'Missing start framing delimiter "<".',
      packet: null,
      expectedCrcHex: '----',
      receivedCrcHex: '----',
      byteLength,
    };
  }

  if (!raw.endsWith('>')) {
    return {
      ok: false,
      code: 'ERR_NO_END_DELIMITER',
      message: 'Missing end framing delimiter ">".',
      packet: null,
      expectedCrcHex: '----',
      receivedCrcHex: '----',
      byteLength,
    };
  }

  if (byteLength > limits.maxFrameLen) {
    return {
      ok: false,
      code: 'ERR_FRAME_OVERFLOW',
      message: `Frame length (${byteLength} B) exceeds SAFECSV_MAX_FRAME_LEN (${limits.maxFrameLen} B).`,
      packet: null,
      expectedCrcHex: '----',
      receivedCrcHex: '----',
      byteLength,
    };
  }

  const inner = raw.slice(1, -1);
  const starIdx = inner.lastIndexOf('*');
  if (starIdx === -1 || starIdx === inner.length - 1) {
    return {
      ok: false,
      code: 'ERR_MISSING_CRC',
      message: 'Missing "*CRC" integrity suffix.',
      packet: null,
      expectedCrcHex: '----',
      receivedCrcHex: '----',
      byteLength,
    };
  }

  const body = inner.slice(0, starIdx);
  const receivedCrcHex = inner.slice(starIdx + 1).toUpperCase();
  const expectedCrcHex = formatCrcHex(computeCrc16CcittFalse(body));

  if (receivedCrcHex !== expectedCrcHex) {
    return {
      ok: false,
      code: 'ERR_CRC_MISMATCH',
      message: `CRC-16/CCITT-FALSE mismatch: got *${receivedCrcHex}, expected *${expectedCrcHex}.`,
      packet: null,
      expectedCrcHex,
      receivedCrcHex,
      byteLength,
    };
  }

  const tokens = body.split(',');
  if (tokens.length < 8) {
    return {
      ok: false,
      code: 'ERR_BAD_HEADER',
      message: `Header requires 8 comma-separated fields; found ${tokens.length}.`,
      packet: null,
      expectedCrcHex,
      receivedCrcHex,
      byteLength,
    };
  }

  const version = Number(tokens[0]);
  const src = Number(tokens[1]);
  const dest = Number(tokens[2]);
  const type = tokens[3];
  const seq = Number(tokens[4]);
  const ts = tokens[5];
  const ttl = Number(tokens[6]);
  const count = Number(tokens[7]);

  if (
    !Number.isInteger(version) ||
    !Number.isInteger(src) ||
    !Number.isInteger(dest) ||
    !type ||
    type.length !== 1 ||
    !Number.isInteger(seq) ||
    seq < 0 ||
    seq > 65535 ||
    !/^\d+$/.test(ts) ||
    !Number.isInteger(ttl) ||
    !Number.isInteger(count) ||
    count < 0
  ) {
    return {
      ok: false,
      code: 'ERR_BAD_HEADER',
      message: 'One or more fixed header fields failed numeric or format validation.',
      packet: null,
      expectedCrcHex,
      receivedCrcHex,
      byteLength,
    };
  }

  if (src < 1 || src > limits.maxNodeId || dest < 0 || dest > limits.maxNodeId) {
    return {
      ok: false,
      code: 'ERR_NODE_ID_RANGE',
      message: `Node ID out of range (SRC=${src}, DEST=${dest}, MAX=${limits.maxNodeId}).`,
      packet: null,
      expectedCrcHex,
      receivedCrcHex,
      byteLength,
    };
  }

  if (count > limits.maxFields) {
    return {
      ok: false,
      code: 'ERR_FIELD_COUNT_LIMIT',
      message: `Header COUNT (${count}) exceeds SAFECSV_MAX_FIELDS (${limits.maxFields}).`,
      packet: null,
      expectedCrcHex,
      receivedCrcHex,
      byteLength,
    };
  }

  const payloadTokens = tokens.slice(8);
  if (payloadTokens.length !== count) {
    return {
      ok: false,
      code: 'ERR_COUNT_MISMATCH',
      message: `Header COUNT=${count} does not match actual payload field count (${payloadTokens.length}).`,
      packet: null,
      expectedCrcHex,
      receivedCrcHex,
      byteLength,
    };
  }

  const fields: SafeCsvField[] = [];
  for (let i = 0; i < payloadTokens.length; i++) {
    const token = payloadTokens[i];
    const eqIdx = token.indexOf('=');
    if (eqIdx <= 0) {
      return {
        ok: false,
        code: 'ERR_BAD_FIELD_SYNTAX',
        message: `Payload token "${token}" is missing KEY=VALUE separator.`,
        packet: null,
        expectedCrcHex,
        receivedCrcHex,
        byteLength,
      };
    }
    const key = token.slice(0, eqIdx);
    const value = token.slice(eqIdx + 1);

    if (key.length > limits.maxKeyLen) {
      return {
        ok: false,
        code: 'ERR_KEY_LENGTH',
        message: `Key "${key}" (${key.length} chars) exceeds SAFECSV_MAX_KEY_LEN (${limits.maxKeyLen}).`,
        packet: null,
        expectedCrcHex,
        receivedCrcHex,
        byteLength,
      };
    }

    if (value.length > limits.maxValLen) {
      return {
        ok: false,
        code: 'ERR_VALUE_LENGTH',
        message: `Value for "${key}" (${value.length} chars) exceeds SAFECSV_MAX_VAL_LEN (${limits.maxValLen}).`,
        packet: null,
        expectedCrcHex,
        receivedCrcHex,
        byteLength,
      };
    }

    fields.push({ key, value });
  }

  return {
    ok: true,
    code: 'OK',
    message: `Valid frame (${fields.length} fields, CRC *${expectedCrcHex} verified).`,
    packet: {
      version,
      src,
      dest,
      type,
      seq,
      ts,
      ttl,
      fields,
    },
    expectedCrcHex,
    receivedCrcHex,
    byteLength,
  };
}

/**
 * 32-packet sliding replay window with 16-bit sequence rollover and Session ID reboot detection.
 */
export function evaluateReplayWindow(
  tracker: Map<number, ReplayNodeEntry>,
  src: number,
  seq: number,
  sessionId: string | null
): { decision: ReplayDecision; entry: ReplayNodeEntry } {
  const existing = tracker.get(src);

  if (!existing || !existing.initialized) {
    const fresh: ReplayNodeEntry = {
      src,
      initialized: true,
      lastSeq: seq & 0xffff,
      bitmap: 1,
      sessionId,
      acceptedCount: 1,
      duplicateCount: 0,
      rebootCount: 0,
    };
    tracker.set(src, fresh);
    return { decision: 'ACCEPTED_FIRST', entry: fresh };
  }

  // Session ID change indicates sender rebooted -> reset replay window cleanly
  if (sessionId !== null && existing.sessionId !== null && sessionId !== existing.sessionId) {
    const rebooted: ReplayNodeEntry = {
      ...existing,
      lastSeq: seq & 0xffff,
      bitmap: 1,
      sessionId,
      acceptedCount: existing.acceptedCount + 1,
      rebootCount: existing.rebootCount + 1,
    };
    tracker.set(src, rebooted);
    return { decision: 'ACCEPTED_REBOOT_DETECTED', entry: rebooted };
  }

  const normalizedSeq = seq & 0xffff;
  const fwd = (normalizedSeq - existing.lastSeq) & 0xffff;

  if (fwd === 0) {
    const dup: ReplayNodeEntry = {
      ...existing,
      duplicateCount: existing.duplicateCount + 1,
    };
    tracker.set(src, dup);
    return { decision: 'DROPPED_DUPLICATE', entry: dup };
  }

  if (fwd < 0x8000) {
    // Forward advance with 16-bit rollover support
    const shifted = fwd >= 32 ? 0 : ((existing.bitmap << fwd) >>> 0);
    const updated: ReplayNodeEntry = {
      ...existing,
      lastSeq: normalizedSeq,
      bitmap: (shifted | 1) >>> 0,
      sessionId: sessionId ?? existing.sessionId,
      acceptedCount: existing.acceptedCount + 1,
    };
    tracker.set(src, updated);
    return { decision: 'ACCEPTED_NEW', entry: updated };
  }

  // Out-of-order / behind lastSeq
  const back = (existing.lastSeq - normalizedSeq) & 0xffff;
  if (back >= 32) {
    const tooOld: ReplayNodeEntry = {
      ...existing,
      duplicateCount: existing.duplicateCount + 1,
    };
    tracker.set(src, tooOld);
    return { decision: 'DROPPED_TOO_OLD', entry: tooOld };
  }

  const bitMask = (1 << back) >>> 0;
  if ((existing.bitmap & bitMask) !== 0) {
    const dup: ReplayNodeEntry = {
      ...existing,
      duplicateCount: existing.duplicateCount + 1,
    };
    tracker.set(src, dup);
    return { decision: 'DROPPED_DUPLICATE', entry: dup };
  }

  const oooAccepted: ReplayNodeEntry = {
    ...existing,
    bitmap: (existing.bitmap | bitMask) >>> 0,
    acceptedCount: existing.acceptedCount + 1,
  };
  tracker.set(src, oooAccepted);
  return { decision: 'ACCEPTED_OUT_OF_ORDER', entry: oooAccepted };
}

export function getFieldString(packet: SafeCsvPacket, key: string): string | null {
  const found = packet.fields.find((f) => f.key === key);
  return found ? found.value : null;
}

export function getFieldFloat(packet: SafeCsvPacket, key: string): number | null {
  const raw = getFieldString(packet, key);
  if (raw === null) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

export function getFieldInt(packet: SafeCsvPacket, key: string): number | null {
  const raw = getFieldString(packet, key);
  if (raw === null) return null;
  if (!/^-?\d+$/.test(raw.trim())) return null;
  const num = Number.parseInt(raw, 10);
  return Number.isSafeInteger(num) ? num : null;
}

export function computeSramFootprint(limits: ProtocolLimits) {
  // Approximate static C++ struct sizing on 32-bit Xtensa ESP32
  const fieldBytes = (limits.maxKeyLen + 1) + (limits.maxValLen + 1);
  const packetHeaderBytes = 24; // version, src, dest, type, seq, ts(8), ttl, count, padding
  const packetStructBytes = packetHeaderBytes + limits.maxFields * fieldBytes;
  const txQueueBytes = limits.txQueueDepth * limits.maxFrameLen;
  const rxBufferBytes = limits.maxFrameLen + 32;
  const replayTrackerBytes = (limits.maxNodeId + 1) * 20; // per-node entry
  const singleLinkBytes = txQueueBytes + rxBufferBytes + 64;
  const dualUartTotalBytes = packetStructBytes + replayTrackerBytes + singleLinkBytes * 2;

  return {
    fieldBytes,
    packetStructBytes,
    txQueueBytes,
    rxBufferBytes,
    replayTrackerBytes,
    singleLinkBytes,
    dualUartTotalBytes,
  };
}

export interface PacketPreset {
  id: string;
  label: string;
  description: string;
  packet: SafeCsvPacket;
}

export const PACKET_PRESETS: PacketPreset[] = [
  {
    id: 'original_3',
    label: 'Original 3-Field Packet',
    description: 'Initial telemetry deployment: CO2, humidity, and temperature.',
    packet: {
      version: 1,
      src: 2,
      dest: 0,
      type: 'S',
      seq: 100,
      ts: '1732183000',
      ttl: 3,
      fields: [
        { key: 'CO2', value: '480' },
        { key: 'HUM', value: '65.5' },
        { key: 'TEMP', value: '24.2' },
      ],
    },
  },
  {
    id: 'extended_7',
    label: 'Extended 7-Field Packet',
    description: 'Adds PRESS, namespaced S7.CO2 + S7.TS, and DOOR without altering CsvProtocol.h.',
    packet: {
      version: 1,
      src: 2,
      dest: 0,
      type: 'S',
      seq: 101,
      ts: '1732183005',
      ttl: 3,
      fields: [
        { key: 'CO2', value: '480' },
        { key: 'HUM', value: '65.5' },
        { key: 'TEMP', value: '24.2' },
        { key: 'PRESS', value: '1013.2' },
        { key: 'S7.CO2', value: '510' },
        { key: 'S7.TS', value: '1732183004' },
        { key: 'DOOR', value: '1' },
      ],
    },
  },
  {
    id: 'control_cmd',
    label: 'Control Command (Node 1 → 3)',
    description: 'Targeted actuator command with relay and fan PWM setpoint.',
    packet: {
      version: 1,
      src: 1,
      dest: 3,
      type: 'C',
      seq: 42,
      ts: '1732183020',
      ttl: 3,
      fields: [
        { key: 'RELAY1', value: '1' },
        { key: 'FAN_PWM', value: '75' },
        { key: 'S8.TEMP', value: '29.5' },
      ],
    },
  },
  {
    id: 'rollover_test',
    label: '16-Bit Sequence Rollover',
    description: 'SEQ at 65535 to verify wrap-around from 65535 → 0 in replay tracker.',
    packet: {
      version: 1,
      src: 1,
      dest: 0,
      type: 'S',
      seq: 65535,
      ts: '1732183099',
      ttl: 3,
      fields: [
        { key: 'CO2', value: '505' },
        { key: 'TEMP', value: '24.6' },
      ],
    },
  },
];
