import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowLeftRight,
  Copy,
  Play,
  RotateCcw,
  Send,
  ShieldAlert,
  Trash2,
  Zap,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Power,
  Pause,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { ScrollingTitle } from './ScrollingTitle';
import {
  encodeFrame,
  evaluateReplayWindow,
  getFieldFloat,
  getFieldInt,
  getFieldString,
  PACKET_PRESETS,
  parseFrame,
  ProtocolLimits,
  ReplayDecision,
  ReplayNodeEntry,
  SafeCsvPacket,
} from '../protocol/safeCsvEngine';

type TopologyId = 'chain' | 'dual_uart' | 'bidirectional';
type FaultMode =
  | 'none'
  | 'corrupt_crc'
  | 'duplicate_replay'
  | 'timeout_stall'
  | 'missing_end'
  | 'overflow';
type WindowTab = 'transfer' | 'fields' | 'log';

interface QueuedFrame {
  id: string;
  packet: SafeCsvPacket;
  rawFrame: string;
  crcHex: string;
  targetWindows: number[];
  actionLabel: 'queueSendStamped' | 'queueReplicate' | 'queueForward' | 'sendAck';
}

interface SentFrameTrace {
  id: string;
  timeLabel: string;
  actionLabel: 'queueSendStamped' | 'queueReplicate' | 'queueForward' | 'sendAck';
  packet: SafeCsvPacket;
  rawFrame: string;
  crcHex: string;
  targetWindows: number[];
  ackStatus: 'none' | 'pending' | 'verified';
  ackedByWindow?: number;
  ackCrcHex?: string;
  ackTimeLabel?: string;
}

interface WindowLogEntry {
  id: string;
  timeLabel: string;
  kind: 'TX' | 'RX_OK' | 'RX_ERR' | 'DROP_DUP' | 'DROP_TTL' | 'FWD' | 'REBOOT' | 'QUEUE_FULL' | 'ACK_OK' | 'ACK_FAIL';
  summary: string;
  rawFrame?: string;
}

interface NodeWindowState {
  windowIndex: number; // 1..4
  nodeId: number;
  title: string;
  role: string;
  sequence: number;
  sessionId: string;
  includeSessionField: boolean;
  knownKeys: string[];
  txQueue: QueuedFrame[];
  lastTxTrace: SentFrameTrace | null;
  sentTraces: SentFrameTrace[];
  lastRxRaw: string;
  lastRxPacket: SafeCsvPacket | null;
  lastRxCrcHex: string | null;
  lastRxStatus: string;
  lastRxSeverity: 'neutral' | 'ok' | 'warn' | 'err';
  lastReplayDecision: ReplayDecision | null;
  rxAccepted: number;
  rxRejected: number;
  txSent: number;
  forwardedCount: number;
  logs: WindowLogEntry[];
  activeTab: WindowTab;
  collapsed: boolean;
}

interface FourWindowTransferLabProps {
  limits: ProtocolLimits;
  designedPacket: SafeCsvPacket;
}

function randomSessionHex(): string {
  return Math.floor(0x10000000 + Math.random() * 0xefffffff)
    .toString(16)
    .toUpperCase();
}

function nowTimeStr(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function makeInitialWindows(): NodeWindowState[] {
  return [
    {
      windowIndex: 1,
      nodeId: 1,
      title: 'Window 1 · Primary ESP32',
      role: 'Originator & Dual-UART Bridge',
      sequence: 100,
      sessionId: '4A9F21C0',
      includeSessionField: false,
      knownKeys: ['CO2', 'HUM', 'TEMP', 'PRESS'],
      txQueue: [],
      lastTxTrace: null,
      sentTraces: [],
      lastRxRaw: '',
      lastRxPacket: null,
      lastRxCrcHex: null,
      lastRxStatus: 'Idle · Ready to transmit',
      lastRxSeverity: 'neutral',
      lastReplayDecision: null,
      rxAccepted: 0,
      rxRejected: 0,
      txSent: 0,
      forwardedCount: 0,
      logs: [],
      activeTab: 'transfer',
      collapsed: false,
    },
    {
      windowIndex: 2,
      nodeId: 2,
      title: 'Window 2 · Secondary ESP32',
      role: 'Serial1 Sensor Hub & Relay',
      sequence: 200,
      sessionId: '7B12E804',
      includeSessionField: false,
      knownKeys: ['CO2', 'TEMP', 'S7.CO2', 'S7.TS'],
      txQueue: [],
      lastTxTrace: null,
      sentTraces: [],
      lastRxRaw: '',
      lastRxPacket: null,
      lastRxCrcHex: null,
      lastRxStatus: 'Listening on UART RX',
      lastRxSeverity: 'neutral',
      lastReplayDecision: null,
      rxAccepted: 0,
      rxRejected: 0,
      txSent: 0,
      forwardedCount: 0,
      logs: [],
      activeTab: 'transfer',
      collapsed: false,
    },
    {
      windowIndex: 3,
      nodeId: 3,
      title: 'Window 3 · Third ESP32',
      role: 'Serial2 Actuator & Relay',
      sequence: 300,
      sessionId: '9C4410B2',
      includeSessionField: false,
      knownKeys: ['HUM', 'DOOR', 'RELAY1', 'FAN_PWM', 'ACK_SEQ', 'ACK_SRC', 'ACK_CRC', 'STATUS'],
      txQueue: [],
      lastTxTrace: null,
      sentTraces: [],
      lastRxRaw: '',
      lastRxPacket: null,
      lastRxCrcHex: null,
      lastRxStatus: 'Listening on UART RX',
      lastRxSeverity: 'neutral',
      lastReplayDecision: null,
      rxAccepted: 0,
      rxRejected: 0,
      txSent: 0,
      forwardedCount: 0,
      logs: [],
      activeTab: 'transfer',
      collapsed: false,
    },
    {
      windowIndex: 4,
      nodeId: 4,
      title: 'Window 4 · Gateway / DWIN Monitor',
      role: 'Sink Telemetry & Command Console',
      sequence: 400,
      sessionId: 'D108A55E',
      includeSessionField: false,
      knownKeys: ['CO2', 'HUM', 'TEMP', 'PRESS', 'S7.CO2', 'S7.TS', 'DOOR', 'S8.TEMP', 'ACK_SEQ', 'ACK_SRC', 'ACK_CRC', 'STATUS'],
      txQueue: [],
      lastTxTrace: null,
      sentTraces: [],
      lastRxRaw: '',
      lastRxPacket: null,
      lastRxCrcHex: null,
      lastRxStatus: 'Listening on UART RX',
      lastRxSeverity: 'neutral',
      lastReplayDecision: null,
      rxAccepted: 0,
      rxRejected: 0,
      txSent: 0,
      forwardedCount: 0,
      logs: [],
      activeTab: 'transfer',
      collapsed: false,
    },
  ];
}

export const FourWindowTransferLab: React.FC<FourWindowTransferLabProps> = ({
  limits,
  designedPacket,
}) => {
  const [windows, setWindows] = useState<NodeWindowState[]>(makeInitialWindows);
  const windowsRef = useRef<NodeWindowState[]>(windows);
  windowsRef.current = windows;
  const [topology, setTopology] = useState<TopologyId>('chain');
  const [faultMode, setFaultMode] = useState<FaultMode>('none');
  const [autoRelay, setAutoRelay] = useState<boolean>(false);
  const [draftPacket, setDraftPacket] = useState<SafeCsvPacket>(designedPacket);
  const [attachSessionId, setAttachSessionId] = useState<boolean>(false);
  const [activeTransferEdge, setActiveTransferEdge] = useState<string | null>(null);
  const [customRawInputs, setCustomRawInputs] = useState<Record<number, string>>({});
  const [transferFlow, setTransferFlow] = useState<{
    fromWin: number | null;
    toWins: number[];
    triggerKey: string;
    nonce: number;
  } | null>(null);
  const glowNonceRef = useRef<number>(0);
  const transferBurstTimerRef = useRef<number | null>(null);
  const transferEdgeTimerRef = useRef<number | null>(null);
  const sweepTimersRef = useRef<number[]>([]);

  const clearSweepTimers = () => {
    sweepTimersRef.current.forEach((id) => window.clearTimeout(id));
    sweepTimersRef.current = [];
  };

  const triggerFlowGlow = (
    fromWin: number | null,
    toWins: number[],
    triggerKey: string
  ) => {
    if (transferBurstTimerRef.current !== null) {
      window.clearTimeout(transferBurstTimerRef.current);
    }
    glowNonceRef.current += 1;
    setTransferFlow({
      fromWin,
      toWins,
      triggerKey,
      nonce: glowNonceRef.current,
    });
    // 3 pulses * 0.7s = 2100ms; clear right after the 3rd glow completes
    transferBurstTimerRef.current = window.setTimeout(() => {
      setTransferFlow(null);
      transferBurstTimerRef.current = null;
    }, 2150);
  };

  useEffect(() => {
    return () => {
      if (transferBurstTimerRef.current !== null) {
        window.clearTimeout(transferBurstTimerRef.current);
      }
      if (transferEdgeTimerRef.current !== null) {
        window.clearTimeout(transferEdgeTimerRef.current);
      }
      clearSweepTimers();
    };
  }, []);

  // Independent 32-packet replay tracker per window (simulating each ESP32's SafeCsvSequenceTracker)
  const trackersRef = useRef<Record<number, Map<number, ReplayNodeEntry>>>({
    1: new Map(),
    2: new Map(),
    3: new Map(),
    4: new Map(),
  });

  useEffect(() => {
    setDraftPacket(designedPacket);
  }, [designedPacket]);

  const getNextTargets = (fromWindow: number, topo: TopologyId): number[] => {
    if (topo === 'chain') {
      return fromWindow < 4 ? [fromWindow + 1] : [];
    }
    if (topo === 'dual_uart') {
      if (fromWindow === 1) return [2, 3];
      if (fromWindow === 2) return [3, 4];
      if (fromWindow === 3) return [4];
      return [];
    }
    // bidirectional ring / mesh
    if (fromWindow === 1) return [2];
    if (fromWindow === 2) return [3];
    if (fromWindow === 3) return [4];
    return [1];
  };

  const getPrevTarget = (fromWindow: number): number[] => {
    if (fromWindow > 1) return [fromWindow - 1];
    return [];
  };

  const applyWireFault = (rawFrame: string, mode: FaultMode): { wire: string; note: string | null } => {
    if (mode === 'none') return { wire: rawFrame, note: null };
    if (mode === 'corrupt_crc') {
      const starPos = rawFrame.lastIndexOf('*');
      if (starPos > 0 && starPos + 2 < rawFrame.length) {
        const flipped = rawFrame[starPos + 1] === 'F' ? '0' : 'F';
        const mutated =
          rawFrame.slice(0, starPos + 1) + flipped + rawFrame.slice(starPos + 2);
        return { wire: mutated, note: 'Fault injected: 1 hex nibble flipped in CRC' };
      }
      return { wire: rawFrame, note: null };
    }
    if (mode === 'missing_end') {
      return {
        wire: rawFrame.endsWith('>') ? rawFrame.slice(0, -1) : rawFrame,
        note: 'Fault injected: dropped ">" end delimiter',
      };
    }
    if (mode === 'timeout_stall') {
      const cut = Math.max(8, Math.floor(rawFrame.length * 0.55));
      return {
        wire: rawFrame.slice(0, cut),
        note: `Fault injected: UART stalled after ${limits.frameTimeoutMs}ms (${cut} bytes)`,
      };
    }
    if (mode === 'overflow') {
      const filler = ',PAD=' + 'X'.repeat(Math.max(100, limits.maxFrameLen + 32));
      const starPos = rawFrame.lastIndexOf('*');
      const mutated = rawFrame.slice(0, starPos) + filler + rawFrame.slice(starPos);
      return {
        wire: mutated,
        note: `Fault injected: frame overflow (${mutated.length} B > ${limits.maxFrameLen} B)`,
      };
    }
    return { wire: rawFrame, note: null };
  };

  const deliverFrameToWindow = (
    targetWinIdx: number,
    rawWire: string,
    fromWinIdx: number | null,
    faultNote: string | null
  ) => {
    setActiveTransferEdge(fromWinIdx ? `${fromWinIdx}->${targetWinIdx}` : `ext->${targetWinIdx}`);
    if (transferEdgeTimerRef.current !== null) {
      window.clearTimeout(transferEdgeTimerRef.current);
    }
    transferEdgeTimerRef.current = window.setTimeout(() => {
      setActiveTransferEdge(null);
      transferEdgeTimerRef.current = null;
    }, 1200);
    if (fromWinIdx === null) {
      triggerFlowGlow(null, [targetWinIdx], `inject-${targetWinIdx}`);
    }

    const parsed = parseFrame(rawWire, limits);

    setWindows((prev) =>
      prev.map((win) => {
        if (win.windowIndex !== targetWinIdx) return win;

        const timeLabel = nowTimeStr();
        if (!parsed.ok || !parsed.packet) {
          const errEntry: WindowLogEntry = {
            id: `${Date.now()}-${Math.random()}`,
            timeLabel,
            kind: 'RX_ERR',
            summary: `${fromWinIdx ? `From W${fromWinIdx}: ` : ''}${parsed.message}${faultNote ? ` (${faultNote})` : ''}`,
            rawFrame: rawWire,
          };
          return {
            ...win,
            lastRxRaw: rawWire,
            lastRxCrcHex: null,
            lastRxStatus: `${parsed.code}: ${parsed.message}`,
            lastRxSeverity: 'err',
            rxRejected: win.rxRejected + 1,
            logs: [errEntry, ...win.logs].slice(0, 40),
          };
        }

        const pkt = parsed.packet;
        const sidVal = getFieldString(pkt, 'SID');
        const tracker = trackersRef.current[targetWinIdx];
        const { decision } = evaluateReplayWindow(tracker, pkt.src, pkt.seq, sidVal);

        if (decision === 'DROPPED_DUPLICATE' || decision === 'DROPPED_TOO_OLD') {
          const dropEntry: WindowLogEntry = {
            id: `${Date.now()}-${Math.random()}`,
            timeLabel,
            kind: 'DROP_DUP',
            summary: `Replay window rejected SRC=${pkt.src} SEQ=${pkt.seq} (${decision})`,
            rawFrame: rawWire,
          };
          return {
            ...win,
            lastRxRaw: rawWire,
            lastRxCrcHex: parsed.expectedCrcHex,
            lastRxStatus: `Duplicate rejected (${decision}) · SRC=${pkt.src} SEQ=${pkt.seq}`,
            lastRxSeverity: 'warn',
            lastReplayDecision: decision,
            rxRejected: win.rxRejected + 1,
            logs: [dropEntry, ...win.logs].slice(0, 40),
          };
        }

        // Handle ACK verification against this window's sent/forwarded TX trace ledger
        if (pkt.type === 'A') {
          const ackSeqStr = getFieldString(pkt, 'ACK_SEQ');
          const ackSrcStr = getFieldString(pkt, 'ACK_SRC');
          const ackCrcStr = getFieldString(pkt, 'ACK_CRC');
          const ackSeqNum = ackSeqStr !== null ? Number(ackSeqStr) : NaN;

          // 1. Exact hop match (SEQ + optional SRC + optional exact transmitted CRC)
          let matchedTrace = win.sentTraces.find(
            (t) =>
              t.packet.type !== 'A' &&
              t.packet.seq === ackSeqNum &&
              (!ackSrcStr || String(t.packet.src) === ackSrcStr) &&
              (!ackCrcStr || t.crcHex.toUpperCase() === ackCrcStr.toUpperCase())
          );

          let matchKind: 'exact_crc' | 'multi_hop' | 'none' = matchedTrace ? 'exact_crc' : 'none';

          // 2. Multi-hop upstream match (SEQ + SRC match across intermediate TTL hop)
          if (!matchedTrace && Number.isFinite(ackSeqNum)) {
            matchedTrace = win.sentTraces.find(
              (t) =>
                t.packet.type !== 'A' &&
                t.packet.seq === ackSeqNum &&
                (!ackSrcStr || String(t.packet.src) === ackSrcStr)
            );
            if (matchedTrace) {
              matchKind = 'multi_hop';
            }
          }

          if (matchedTrace) {
            const ackedBy = fromWinIdx ?? pkt.src;
            const updatedTraces: SentFrameTrace[] = win.sentTraces.map((t) =>
              t.id === matchedTrace!.id
                ? {
                    ...t,
                    ackStatus: 'verified',
                    ackedByWindow: ackedBy,
                    ackCrcHex: parsed.expectedCrcHex,
                    ackTimeLabel: timeLabel,
                  }
                : t
            );
            const updatedLastTx =
              win.lastTxTrace?.id === matchedTrace.id
                ? {
                    ...win.lastTxTrace,
                    ackStatus: 'verified' as const,
                    ackedByWindow: ackedBy,
                    ackCrcHex: parsed.expectedCrcHex,
                    ackTimeLabel: timeLabel,
                  }
                : win.lastTxTrace;

            const verifyMsg =
              matchKind === 'exact_crc'
                ? `ACK VERIFIED against W${win.windowIndex} TX trace · SEQ=${ackSeqNum} (SRC=${matchedTrace.packet.src}, CRC *${matchedTrace.crcHex}) confirmed by W${ackedBy} · ACK CRC *${parsed.expectedCrcHex} OK`
                : `ACK VERIFIED (multi-hop) against W${win.windowIndex} TX trace · SEQ=${ackSeqNum} (SRC=${matchedTrace.packet.src}, hop CRC *${matchedTrace.crcHex}) · ACK CRC *${parsed.expectedCrcHex} OK`;

            const ackOkLog: WindowLogEntry = {
              id: `${Date.now()}-${Math.random()}`,
              timeLabel,
              kind: 'ACK_OK',
              summary: verifyMsg,
              rawFrame: rawWire,
            };

            return {
              ...win,
              sentTraces: updatedTraces,
              lastTxTrace: updatedLastTx,
              lastRxRaw: rawWire,
              lastRxPacket: pkt,
              lastRxCrcHex: parsed.expectedCrcHex,
              lastRxStatus: verifyMsg,
              lastRxSeverity: 'ok',
              lastReplayDecision: decision,
              rxAccepted: win.rxAccepted + 1,
              logs: [ackOkLog, ...win.logs].slice(0, 40),
            };
          }

          const unverifiedMsg = `ACK UNVERIFIED: No matching TX/FWD trace in W${win.windowIndex} for ACK_SEQ=${ackSeqStr ?? '?'}${ackSrcStr ? ` SRC=${ackSrcStr}` : ''}${ackCrcStr ? ` CRC=*${ackCrcStr}` : ''} · Frame CRC *${parsed.expectedCrcHex} OK`;
          const ackFailLog: WindowLogEntry = {
            id: `${Date.now()}-${Math.random()}`,
            timeLabel,
            kind: 'ACK_FAIL',
            summary: unverifiedMsg,
            rawFrame: rawWire,
          };

          return {
            ...win,
            lastRxRaw: rawWire,
            lastRxPacket: pkt,
            lastRxCrcHex: parsed.expectedCrcHex,
            lastRxStatus: unverifiedMsg,
            lastRxSeverity: 'warn',
            lastReplayDecision: decision,
            rxAccepted: win.rxAccepted + 1,
            logs: [ackFailLog, ...win.logs].slice(0, 40),
          };
        }

        const okMsg =
          decision === 'ACCEPTED_REBOOT_DETECTED'
            ? `Reboot detected (SID=${sidVal}) · Reset replay window · SRC=${pkt.src} SEQ=${pkt.seq}`
            : `CRC *${parsed.expectedCrcHex} OK · ${pkt.fields.length} fields · TTL=${pkt.ttl} (${decision})`;

        const okEntry: WindowLogEntry = {
          id: `${Date.now()}-${Math.random()}`,
          timeLabel,
          kind: 'RX_OK',
          summary: `${fromWinIdx ? `From W${fromWinIdx}: ` : ''}${okMsg}`,
          rawFrame: rawWire,
        };

        return {
          ...win,
          lastRxRaw: rawWire,
          lastRxPacket: pkt,
          lastRxCrcHex: parsed.expectedCrcHex,
          lastRxStatus: okMsg,
          lastRxSeverity: 'ok',
          lastReplayDecision: decision,
          rxAccepted: win.rxAccepted + 1,
          logs: [okEntry, ...win.logs].slice(0, 40),
        };
      })
    );
  };

  // Enqueue packet from a window's NodeIdentity (queueSendStamped / queueReplicate)
  const enqueueFromWindow = (
    winIdx: number,
    basePacket: SafeCsvPacket,
    autoFlush = false
  ) => {
    const win = windowsRef.current.find((w) => w.windowIndex === winIdx);
    if (!win) return;

    const nextSeq = win.sequence;
    const stampedFields = attachSessionId
      ? [
          ...basePacket.fields.filter((f) => f.key !== 'SID'),
          { key: 'SID', value: win.sessionId },
        ]
      : basePacket.fields;

    const stampedPacket: SafeCsvPacket = {
      ...basePacket,
      src: win.nodeId,
      seq: nextSeq,
      ts: String(Math.floor(Date.now() / 1000)),
      fields: stampedFields,
    };

    const encoded = encodeFrame(stampedPacket, limits);
    if (!encoded.ok) {
      const errLog: WindowLogEntry = {
        id: `${Date.now()}-${Math.random()}`,
        timeLabel: nowTimeStr(),
        kind: 'RX_ERR',
        summary: `Encode blocked: ${encoded.issues[0]?.message ?? 'Invalid packet'}`,
      };
      setWindows((prev) =>
        prev.map((w) =>
          w.windowIndex === winIdx
            ? {
                ...w,
                logs: [errLog, ...w.logs].slice(0, 40),
              }
            : w
        )
      );
      return;
    }

    const targets = getNextTargets(winIdx, topology);
    if (win.txQueue.length >= limits.txQueueDepth && !autoFlush) {
      const fullLog: WindowLogEntry = {
        id: `${Date.now()}-${Math.random()}`,
        timeLabel: nowTimeStr(),
        kind: 'QUEUE_FULL',
        summary: `TX Queue full (${limits.txQueueDepth}/${limits.txQueueDepth}) · Frame dropped`,
      };
      setWindows((prev) =>
        prev.map((w) =>
          w.windowIndex === winIdx
            ? {
                ...w,
                logs: [fullLog, ...w.logs].slice(0, 40),
              }
            : w
        )
      );
      return;
    }

    const qItem: QueuedFrame = {
      id: `${Date.now()}-${Math.random()}`,
      packet: stampedPacket,
      rawFrame: encoded.frame,
      crcHex: encoded.crcHex,
      targetWindows: targets,
      actionLabel: targets.length > 1 ? 'queueReplicate' : 'queueSendStamped',
    };

    setWindows((prev) =>
      prev.map((w) =>
        w.windowIndex === winIdx
          ? {
              ...w,
              sequence: (w.sequence + 1) & 0xffff,
              txQueue: autoFlush ? w.txQueue : [...w.txQueue, qItem],
            }
          : w
      )
    );

    if (autoFlush) {
      transmitQueuedItem(winIdx, qItem);
    } else {
      triggerFlowGlow(winIdx, [], `enqueue-${winIdx}`);
    }
  };

  const transmitQueuedItem = (fromWinIdx: number, item: QueuedFrame) => {
    const { wire, note } = applyWireFault(item.rawFrame, faultMode);
    const targets = item.targetWindows;
    const timeLabel = nowTimeStr();

    const trace: SentFrameTrace = {
      id: item.id,
      timeLabel,
      actionLabel: item.actionLabel,
      packet: item.packet,
      rawFrame: wire,
      crcHex: item.crcHex,
      targetWindows: targets,
      ackStatus: item.packet.type === 'A' ? 'none' : 'pending',
    };

    const txLog: WindowLogEntry = {
      id: `${Date.now()}-${Math.random()}`,
      timeLabel,
      kind: item.actionLabel === 'queueForward' ? 'FWD' : 'TX',
      summary: `${item.actionLabel}() → ${targets.map((t) => `W${t}`).join(', ') || 'None'} (${wire.length} B)`,
      rawFrame: wire,
    };

    setWindows((prev) =>
      prev.map((w) =>
        w.windowIndex === fromWinIdx
          ? {
              ...w,
              txSent: w.txSent + 1,
              txQueue: w.txQueue.filter((q) => q.id !== item.id),
              lastTxTrace: trace,
              sentTraces: [trace, ...w.sentTraces].slice(0, 25),
              logs: [txLog, ...w.logs].slice(0, 40),
            }
          : w
      )
    );

    const trigKey =
      item.actionLabel === 'sendAck'
        ? `ack-${fromWinIdx}`
        : item.actionLabel === 'queueForward'
        ? `fwd-${fromWinIdx}`
        : `tx-${fromWinIdx}`;
    triggerFlowGlow(fromWinIdx, targets, trigKey);

    targets.forEach((targetIdx) => {
      deliverFrameToWindow(targetIdx, wire, fromWinIdx, note);
      if (faultMode === 'duplicate_replay') {
        setTimeout(() => {
          deliverFrameToWindow(
            targetIdx,
            wire,
            fromWinIdx,
            'Fault injected: duplicate replay transmission'
          );
        }, 160);
      }
    });
  };

  const processNextTxInWindow = (winIdx: number) => {
    const win = windowsRef.current.find((w) => w.windowIndex === winIdx);
    if (!win || win.txQueue.length === 0) return;
    transmitQueuedItem(winIdx, win.txQueue[0]);
  };

  const forwardFromWindow = (winIdx: number, direction: 'next' | 'prev' = 'next') => {
    const win = windowsRef.current.find((w) => w.windowIndex === winIdx);
    if (!win || !win.lastRxPacket) return;

    const pkt = win.lastRxPacket;
    if (pkt.ttl <= 0) {
      const ttlLog: WindowLogEntry = {
        id: `${Date.now()}-${Math.random()}`,
        timeLabel: nowTimeStr(),
        kind: 'DROP_TTL',
        summary: `queueForward() stopped: TTL=0 for SRC=${pkt.src} SEQ=${pkt.seq}`,
      };
      setWindows((prev) =>
        prev.map((w) =>
          w.windowIndex === winIdx
            ? {
                ...w,
                logs: [ttlLog, ...w.logs].slice(0, 40),
              }
            : w
        )
      );
      return;
    }

    const fwdPkt: SafeCsvPacket = {
      ...pkt,
      ttl: pkt.ttl - 1,
    };
    const encoded = encodeFrame(fwdPkt, limits);
    if (!encoded.ok) return;

    const targets =
      direction === 'next' ? getNextTargets(winIdx, topology) : getPrevTarget(winIdx);
    if (targets.length === 0) return;

    const qItem: QueuedFrame = {
      id: `${Date.now()}-${Math.random()}`,
      packet: fwdPkt,
      rawFrame: encoded.frame,
      crcHex: encoded.crcHex,
      targetWindows: targets,
      actionLabel: 'queueForward',
    };

    setWindows((prev) =>
      prev.map((w) =>
        w.windowIndex === winIdx
          ? {
              ...w,
              forwardedCount: w.forwardedCount + 1,
            }
          : w
      )
    );

    transmitQueuedItem(winIdx, qItem);
  };

  const sendAckBack = (fromWinIdx: number) => {
    const win = windowsRef.current.find((w) => w.windowIndex === fromWinIdx);
    if (!win) return;
    const target = fromWinIdx > 1 ? fromWinIdx - 1 : 4;
    const rxPkt = win.lastRxPacket;
    const ackTargetNodeId = rxPkt?.src ?? target;
    const ackFields = rxPkt
      ? [
          { key: 'ACK_SEQ', value: String(rxPkt.seq) },
          { key: 'ACK_SRC', value: String(rxPkt.src) },
          ...(win.lastRxCrcHex ? [{ key: 'ACK_CRC', value: win.lastRxCrcHex }] : []),
          { key: 'STATUS', value: 'OK' },
          ...(attachSessionId ? [{ key: 'SID', value: win.sessionId }] : []),
        ]
      : [
          { key: 'ACK_SEQ', value: '0' },
          { key: 'STATUS', value: 'NO_RX' },
          ...(attachSessionId ? [{ key: 'SID', value: win.sessionId }] : []),
        ];

    const ackPacket: SafeCsvPacket = {
      version: 1,
      src: win.nodeId,
      dest: ackTargetNodeId,
      type: 'A',
      seq: win.sequence,
      ts: String(Math.floor(Date.now() / 1000)),
      ttl: 3,
      fields: ackFields,
    };
    const encoded = encodeFrame(ackPacket, limits);
    if (!encoded.ok) return;

    const qItem: QueuedFrame = {
      id: `${Date.now()}-${Math.random()}`,
      packet: ackPacket,
      rawFrame: encoded.frame,
      crcHex: encoded.crcHex,
      targetWindows: [target],
      actionLabel: 'sendAck',
    };
    setWindows((prev) =>
      prev.map((w) =>
        w.windowIndex === fromWinIdx
          ? { ...w, sequence: (w.sequence + 1) & 0xffff }
          : w
      )
    );
    transmitQueuedItem(fromWinIdx, qItem);
  };

  const rebootWindow = (winIdx: number) => {
    const newSid = randomSessionHex();
    trackersRef.current[winIdx] = new Map();
    setAttachSessionId(true);
    const rebootLog: WindowLogEntry = {
      id: `${Date.now()}-${Math.random()}`,
      timeLabel: nowTimeStr(),
      kind: 'REBOOT',
      summary: `ESP32 rebooted · SEQ=1 · New Session ID ${newSid} (SID attached)`,
    };
    setWindows((prev) =>
      prev.map((w) =>
        w.windowIndex === winIdx
          ? {
              ...w,
              sequence: 1,
              sessionId: newSid,
              txQueue: [],
              logs: [rebootLog, ...w.logs].slice(0, 40),
            }
          : w
      )
    );
  };

  // Auto-relay step effect: moves accepted non-ACK packets across hops W1 -> W2 -> W3 -> W4
  useEffect(() => {
    if (!autoRelay) return;
    const timer = setInterval(() => {
      setWindows((current) => {
        for (const idx of [1, 2, 3]) {
          const w = current.find((item) => item.windowIndex === idx);
          if (
            w &&
            w.lastRxPacket &&
            w.lastRxPacket.type !== 'A' &&
            w.lastRxPacket.ttl > 0 &&
            w.lastRxSeverity === 'ok'
          ) {
            const alreadyLoggedFwd = w.logs[0]?.kind === 'FWD';
            if (!alreadyLoggedFwd) {
              setTimeout(() => forwardFromWindow(idx, 'next'), 0);
              break;
            }
          }
        }
        return current;
      });
    }, 900);
    return () => clearInterval(timer);
  });

  const runFullFourWindowSweep = () => {
    // Sends designed packet from W1 and steps through W2 -> W3 -> W4, updating the glow to each hop
    clearSweepTimers();
    enqueueFromWindow(1, draftPacket, true);
    const t1 = window.setTimeout(() => forwardFromWindow(2, 'next'), 380);
    const t2 = window.setTimeout(() => forwardFromWindow(3, 'next'), 760);
    sweepTimersRef.current = [t1, t2];
  };

  const resetAllWindows = () => {
    clearSweepTimers();
    if (transferBurstTimerRef.current !== null) {
      window.clearTimeout(transferBurstTimerRef.current);
      transferBurstTimerRef.current = null;
    }
    if (transferEdgeTimerRef.current !== null) {
      window.clearTimeout(transferEdgeTimerRef.current);
      transferEdgeTimerRef.current = null;
    }
    trackersRef.current = {
      1: new Map(),
      2: new Map(),
      3: new Map(),
      4: new Map(),
    };
    setWindows(makeInitialWindows());
    setTransferFlow(null);
    setActiveTransferEdge(null);
    setAutoRelay(false);
  };

  const topologySummary = useMemo(() => {
    if (topology === 'chain') return 'W1 → W2 → W3 → W4 (Serial Chain)';
    if (topology === 'dual_uart') return 'W1 (Serial1→W2, Serial2→W3) → W4 (3-ESP32 + Gateway)';
    return 'W1 → W2 → W3 → W4 → W1 (Bidirectional Loop)';
  }, [topology]);

  return (
    <div className="space-y-5">
      {/* Control & Topology Strip */}
      <div className="bg-[var(--t-surface)] border border-[var(--t-border)] rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[var(--t-border-soft)]">
          <div className="min-w-0 flex-1">
            <ScrollingTitle as="h1" className="text-lg font-semibold text-[var(--t-ink)]">
              4-Window UART Transfer Simulator
            </ScrollingTitle>
            <p className="text-sm text-[var(--t-ink-muted)] mt-0.5">
              {topologySummary} · Limits: {limits.maxFields} fields · {limits.maxFrameLen} B buffer · TX depth {limits.txQueueDepth}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                clearSweepTimers();
                enqueueFromWindow(1, draftPacket, true);
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[var(--t-accent)] hover:bg-[var(--t-accent-hover)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                transferFlow && transferFlow.fromWin === 1 && transferFlow.triggerKey === 'tx-1'
                  ? `glow-send-btn-${transferFlow.nonce % 2 === 0 ? 'a' : 'b'}`
                  : ''
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              Send W1 → Next
            </button>
            <button
              onClick={runFullFourWindowSweep}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[var(--t-ink)] bg-[var(--t-surface-alt)] hover:bg-[var(--t-surface-hover)] border border-[var(--t-border-soft)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                transferFlow && sweepTimersRef.current.length > 0
                  ? `glow-send-btn-${transferFlow.nonce % 2 === 0 ? 'a' : 'b'}`
                  : ''
              }`}
            >
              <Play className="w-3.5 h-3.5" />
              Step W1 → W2 → W3 → W4
            </button>
            <button
              onClick={() => setAutoRelay((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                autoRelay
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : 'bg-[var(--t-surface)] border-[var(--t-border)] text-[var(--t-ink)] hover:bg-[var(--t-surface-alt)]'
              }`}
            >
              {autoRelay ? <Pause className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
              {autoRelay ? 'Auto-Relay On' : 'Auto-Relay Off'}
            </button>
            <button
              onClick={resetAllWindows}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--t-ink-muted)] bg-[var(--t-surface)] border border-[var(--t-border)] rounded-lg hover:bg-[var(--t-surface-alt)] hover:text-[var(--t-ink)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Bus
            </button>
          </div>
        </div>

        {/* Second row: Topology, Quick Packet Preset, Fault Injection, Session ID */}
        <div className="pt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="min-w-0">
            <label className="block text-xs font-medium text-[var(--t-ink-muted)] mb-1 truncate">
              Bus Topology
            </label>
            <select
              value={topology}
              onChange={(e) => setTopology(e.target.value as TopologyId)}
              className="w-full min-w-0 truncate px-3 py-2 text-xs font-medium bg-[var(--t-surface-alt)] border border-[var(--t-border)] rounded-lg text-[var(--t-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--t-accent)]/25 focus:border-[var(--t-accent)]"
            >
              <option value="chain">Linear Chain (W1 → W2 → W3 → W4)</option>
              <option value="dual_uart">3-ESP32 Dual-UART + Gateway</option>
              <option value="bidirectional">Closed Ring (W1 → W2 → W3 → W4 → W1)</option>
            </select>
          </div>

          <div className="min-w-0">
            <label className="block text-xs font-medium text-[var(--t-ink-muted)] mb-1 truncate">
              Window 1 Payload Preset
            </label>
            <select
              onChange={(e) => {
                const found = PACKET_PRESETS.find((p) => p.id === e.target.value);
                if (found) setDraftPacket(found.packet);
              }}
              defaultValue=""
              className="w-full min-w-0 truncate px-3 py-2 text-xs font-medium bg-[var(--t-surface-alt)] border border-[var(--t-border)] rounded-lg text-[var(--t-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--t-accent)]/25 focus:border-[var(--t-accent)]"
            >
              <option value="" disabled>
                Active Designer Packet ({draftPacket.fields.length} fields)
              </option>
              {PACKET_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label className="block text-xs font-medium text-[var(--t-ink-muted)] mb-1 truncate">
              Wire Fault Injection
            </label>
            <select
              value={faultMode}
              onChange={(e) => setFaultMode(e.target.value as FaultMode)}
              className={`w-full min-w-0 truncate px-3 py-2 text-xs font-medium border rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--t-accent)]/25 ${
                faultMode === 'none'
                  ? 'bg-[var(--t-surface-alt)] border-[var(--t-border)] text-[var(--t-ink)]'
                  : 'bg-amber-50 border-amber-300 text-amber-900'
              }`}
            >
              <option value="none">Normal Wire (No Faults)</option>
              <option value="corrupt_crc">Corrupt 1 Nibble (CRC-16 Fail)</option>
              <option value="duplicate_replay">Duplicate Replay (32-Window Drop)</option>
              <option value="timeout_stall">Truncate Frame (500ms Timeout)</option>
              <option value="missing_end">Drop End Delimiter (&gt;)</option>
              <option value="overflow">Exceed Buffer ({limits.maxFrameLen} B Overflow)</option>
            </select>
          </div>

          <div className="flex items-end min-w-0">
            <label className="flex items-center gap-2.5 w-full min-w-0 px-3 py-2 text-xs font-medium bg-[var(--t-surface-alt)] border border-[var(--t-border)] rounded-lg text-[var(--t-ink)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={attachSessionId}
                onChange={(e) => setAttachSessionId(e.target.checked)}
                className="rounded border-[var(--t-border)] accent-[var(--t-accent)] shrink-0"
              />
              <span className="truncate">Embed Session ID (SID) for Reboot Detection</span>
            </label>
          </div>
        </div>

        {/* Visual Hop Pipeline Bar */}
        <div className="mt-4 pt-3 border-t border-[var(--t-border-soft)] flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--t-ink-muted)]">
          <div className="flex flex-wrap items-center gap-2 font-mono">
            {[1, 2, 3, 4].map((idx, i) => {
              const win = windows[idx - 1];
              const edgeActive =
                activeTransferEdge?.startsWith(`${idx}->`) ||
                activeTransferEdge?.endsWith(`->${idx}`);
              return (
                <React.Fragment key={idx}>
                  <span
                    className={`px-2.5 py-1 rounded-md border transition-colors ${
                      edgeActive
                        ? 'bg-[var(--t-accent)] text-white border-[var(--t-accent)]'
                        : 'bg-[var(--t-surface-alt)] text-[var(--t-ink)] border-[var(--t-border-soft)]'
                    }`}
                  >
                    W{idx} (ID {win.nodeId}) · SEQ {win.sequence}
                  </span>
                  {i < 3 && (
                    <ArrowRight
                      className={`w-3.5 h-3.5 transition-colors ${
                        activeTransferEdge === `${idx}->${idx + 1}` ||
                        (topology === 'dual_uart' && idx === 1 && activeTransferEdge === '1->3')
                          ? 'text-[var(--t-accent)]'
                          : 'text-[var(--t-ink-soft)]'
                      }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
          {faultMode !== 'none' && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800">
              <ShieldAlert className="w-3.5 h-3.5" />
              Fault active: {faultMode.replace('_', ' ')}
            </span>
          )}
        </div>
      </div>

      {/* The 4 Transfer Windows (2x2 Desktop Grid) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        {windows.map((win) => {
          const targets = getNextTargets(win.windowIndex, topology);
          const canForward = Boolean(win.lastRxPacket && win.lastRxPacket.ttl > 0 && targets.length > 0);
          const canSendBack = win.windowIndex > 1;
          const phase = transferFlow ? (transferFlow.nonce % 2 === 0 ? 'a' : 'b') : null;
          const isReceiving = Boolean(phase && transferFlow?.toWins.includes(win.windowIndex));
          const isSending = Boolean(phase && transferFlow?.fromWin === win.windowIndex);
          const isUpstreamPair = win.windowIndex <= 2;
          const windowBorderColor =
            win.windowIndex === 1
              ? 'border-[#ff0000]'
              : win.windowIndex === 2
              ? 'border-[#1D4ED8]'
              : win.windowIndex === 3
              ? 'border-[#047857]'
              : 'border-[#7C3AED]';

          return (
            <section
              key={win.windowIndex}
              className={`bg-[var(--t-surface)] border-[8px] border-dotted ${windowBorderColor} rounded-xl overflow-hidden transition-colors ${
                isReceiving && phase
                  ? `glow-rx-col-${phase}`
                  : isSending && phase
                  ? `glow-tx-col-${phase}`
                  : ''
              }`}
            >
              {/* Window Title & Node Identity Bar */}
              <div
                className={`px-4 py-3 flex flex-wrap items-center justify-between gap-2 ${
                  isUpstreamPair ? 'bg-[var(--t-cobalt-soft)]' : 'bg-[var(--t-teal-soft)]'
                } ${
                  win.collapsed
                    ? ''
                    : isUpstreamPair
                    ? 'border-b border-[var(--t-cobalt-border)]'
                    : 'border-b border-[var(--t-teal-border)]'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <ScrollingTitle as="h2" className="text-sm font-semibold text-[var(--t-ink)]">
                    {win.title}
                  </ScrollingTitle>
                  <p className="text-xs text-[var(--t-ink-muted)] truncate">
                    {win.role} · Session{' '}
                    <span className={`font-mono font-semibold ${isUpstreamPair ? 'text-[var(--t-cobalt)]' : 'text-[var(--t-teal)]'}`}>
                      {win.sessionId}
                    </span>{' '}
                    · Next SEQ{' '}
                    <span className="font-mono tabular-nums font-semibold text-[var(--t-ink)]">
                      {win.sequence}
                    </span>
                    {win.collapsed ? (
                      <span className="font-mono tabular-nums">
                        {' '}· TX {win.txSent} · RX {win.rxAccepted}
                      </span>
                    ) : null}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => rebootWindow(win.windowIndex)}
                    title="Simulate ESP32 reboot (resets SEQ to 1 and rotates Session ID)"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[var(--t-ink)] bg-[var(--t-surface)] border border-[var(--t-border)] rounded-md hover:bg-[var(--t-surface-hover)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Power className="w-3 h-3" />
                    Reboot
                  </button>
                  <button
                    onClick={() =>
                      setWindows((prev) =>
                        prev.map((w) =>
                          w.windowIndex === win.windowIndex
                            ? {
                                ...w,
                                logs: [],
                                lastRxRaw: '',
                                lastRxPacket: null,
                                lastRxCrcHex: null,
                                lastTxTrace: null,
                                sentTraces: [],
                                lastRxStatus: 'Cleared',
                                lastRxSeverity: 'neutral',
                              }
                            : w
                        )
                      )
                    }
                    title="Clear window log"
                    className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-[var(--t-ink-muted)] bg-[var(--t-surface)] border border-[var(--t-border)] rounded-md hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-ink)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() =>
                      setWindows((prev) =>
                        prev.map((w) =>
                          w.windowIndex === win.windowIndex
                            ? { ...w, collapsed: !w.collapsed }
                            : w
                        )
                      )
                    }
                    aria-expanded={!win.collapsed}
                    aria-label={win.collapsed ? `Expand ${win.title}` : `Collapse ${win.title}`}
                    title={win.collapsed ? 'Expand window' : 'Collapse window'}
                    className="inline-flex items-center justify-center p-1.5 text-[var(--t-ink-muted)] bg-[var(--t-surface)] border border-[var(--t-border)] rounded-md hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-ink)] transition-colors shrink-0 cursor-pointer"
                  >
                    {win.collapsed ? (
                      <ChevronRight className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {!win.collapsed && (
                <>
                  {/* Window Sub-Toolbar: Segmented Tab + Metrics */}
                  <div className="px-4 py-2.5 border-b border-[var(--t-border-soft)] flex flex-wrap items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-1 p-0.5 bg-[var(--t-surface-alt)] border border-[var(--t-border-soft)] rounded-lg">
                      {(['transfer', 'fields', 'log'] as WindowTab[]).map((tab) => (
                        <button
                          key={tab}
                          onClick={() =>
                            setWindows((prev) =>
                              prev.map((w) =>
                                w.windowIndex === win.windowIndex ? { ...w, activeTab: tab } : w
                              )
                            )
                          }
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            win.activeTab === tab
                              ? 'bg-[var(--t-surface)] text-[var(--t-ink)] shadow-xs'
                              : 'text-[var(--t-ink-muted)] hover:text-[var(--t-ink)]'
                          } ${
                            tab === 'fields' && win.lastRxPacket && isReceiving && phase
                              ? `glow-interpret-col-${phase} text-[var(--t-cobalt)]`
                              : ''
                          }`}
                        >
                          {tab === 'transfer' && 'Transfer & Queue'}
                          {tab === 'fields' && `Fields (${win.lastRxPacket?.fields.length ?? 0})`}
                          {tab === 'log' && `UART Log (${win.logs.length})`}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-[var(--t-ink-muted)] font-mono tabular-nums">
                      <span
                        className={`px-2 py-0.5 rounded border border-amber-300/80 bg-amber-50/80 text-[var(--t-accent)] font-semibold ${
                          isSending && phase ? `glow-tx-col-${phase}` : ''
                        }`}
                      >
                        TX: {win.txSent}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded border border-[var(--t-emerald-border)] bg-[var(--t-emerald-soft)] text-[var(--t-emerald)] font-semibold ${
                          isReceiving && phase ? `glow-rx-col-${phase}` : ''
                        }`}
                      >
                        RX: {win.rxAccepted}
                      </span>
                      <span className={win.rxRejected > 0 ? 'text-[var(--t-accent)] font-semibold' : ''}>
                        Drop: {win.rxRejected}
                      </span>
                    </div>
                  </div>

                  {/* Window Body */}
                  <div className="p-4 space-y-3.5">
                    {win.activeTab === 'transfer' && (
                      <>
                        {/* RX Validation Status Banner (Receive Data Column) */}
                        <div
                          className={`px-3 py-2.5 rounded-lg border text-xs flex items-start gap-2 transition-shadow ${
                            win.lastRxSeverity === 'ok'
                              ? 'bg-[var(--t-emerald-soft)] border-[var(--t-emerald-border)] text-[var(--t-emerald)]'
                              : win.lastRxSeverity === 'warn'
                              ? 'bg-[var(--t-accent-soft)]/50 border-[var(--t-accent-border)] text-[var(--t-ink)]'
                              : win.lastRxSeverity === 'err'
                              ? 'bg-red-50 border-red-200 text-red-900'
                              : 'bg-[var(--t-surface-alt)] border-[var(--t-border-soft)] text-[var(--t-ink-muted)]'
                          } ${isReceiving && phase ? `glow-rx-col-${phase}` : ''}`}
                        >
                          {win.lastRxSeverity === 'ok' && (
                            <CheckCircle2 className="w-4 h-4 text-[var(--t-emerald)] shrink-0 mt-0.5" />
                          )}
                          {win.lastRxSeverity === 'warn' && (
                            <AlertTriangle className="w-4 h-4 text-[var(--t-accent)] shrink-0 mt-0.5" />
                          )}
                          {win.lastRxSeverity === 'err' && (
                            <XCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">{win.lastRxStatus}</div>
                            {win.lastRxRaw && (
                              <div
                                className={`mt-1 font-mono text-[11px] break-all bg-[var(--t-code-bg)] border border-[var(--t-emerald-border)] text-[var(--t-ink)] px-2.5 py-1.5 rounded-md ${
                                  isReceiving && phase ? `glow-rx-col-${phase}` : ''
                                }`}
                              >
                                {win.lastRxRaw}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Decoded Header Strip (Interpretation Column) */}
                        {win.lastRxPacket ? (
                          <div
                            className={`p-1.5 rounded-lg border border-[var(--t-cobalt-border)] bg-[var(--t-cobalt-soft)]/40 grid grid-cols-4 sm:grid-cols-8 gap-1.5 text-center ${
                              isReceiving && phase ? `glow-interpret-col-${phase}` : ''
                            }`}
                          >
                            {[
                              ['VER', win.lastRxPacket.version],
                              ['SRC', win.lastRxPacket.src],
                              ['DEST', win.lastRxPacket.dest],
                              ['TYPE', win.lastRxPacket.type],
                              ['SEQ', win.lastRxPacket.seq],
                              ['TS', win.lastRxPacket.ts],
                              ['TTL', win.lastRxPacket.ttl],
                              ['CNT', win.lastRxPacket.fields.length],
                            ].map(([lbl, val]) => (
                              <div
                                key={String(lbl)}
                                className="min-w-0 px-1 py-1.5 bg-[var(--t-cobalt-soft)] border border-[var(--t-cobalt-border)] rounded-md"
                              >
                                <div className="text-[11px] leading-tight font-medium text-[var(--t-cobalt)] truncate">{lbl}</div>
                                <div className="text-[12.5px] leading-tight font-mono font-semibold text-[var(--t-ink)] truncate tabular-nums">
                                  {val}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 py-3 text-xs text-[var(--t-ink-soft)] bg-[var(--t-surface-alt)] border border-dashed border-[var(--t-border)] rounded-lg text-center">
                            No packet buffered in Window {win.windowIndex}. Transmit from Window 1 or inject a raw frame below.
                          </div>
                        )}

                        {/* TX Actions: Enqueue, Process TX, Forward Next, Reply ACK */}
                        <div className="flex flex-wrap items-center gap-2">
                          {win.windowIndex === 1 && (
                            <>
                              <button
                                onClick={() => enqueueFromWindow(1, draftPacket, false)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--t-ink)] bg-[var(--t-surface-alt)] hover:bg-[var(--t-surface-hover)] border border-[var(--t-border-soft)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                  phase && transferFlow?.triggerKey === 'enqueue-1'
                                    ? `glow-send-btn-${phase}`
                                    : ''
                                }`}
                              >
                                queueSendStamped()
                              </button>
                              <button
                                onClick={() => processNextTxInWindow(1)}
                                disabled={win.txQueue.length === 0}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[var(--t-accent)] hover:bg-[var(--t-accent-hover)] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                  phase && transferFlow?.triggerKey === 'tx-1'
                                    ? `glow-send-btn-${phase}`
                                    : ''
                                }`}
                              >
                                processTx() ({win.txQueue.length}/{limits.txQueueDepth})
                              </button>
                            </>
                          )}

                          {targets.length > 0 && win.windowIndex > 1 && (
                            <button
                              onClick={() => forwardFromWindow(win.windowIndex, 'next')}
                              disabled={!canForward}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[var(--t-accent)] hover:bg-[var(--t-accent-hover)] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                phase && transferFlow?.triggerKey === `fwd-${win.windowIndex}`
                                  ? `glow-send-btn-${phase}`
                                  : ''
                              }`}
                            >
                              <ArrowRight className="w-3.5 h-3.5" />
                              queueForward() → {targets.map((t) => `W${t}`).join(', ')}
                              {win.lastRxPacket ? ` (TTL ${Math.max(0, win.lastRxPacket.ttl - 1)})` : ''}
                            </button>
                          )}

                          {win.windowIndex > 1 && (
                            <button
                              onClick={() =>
                                enqueueFromWindow(
                                  win.windowIndex,
                                  {
                                    version: 1,
                                    src: win.nodeId,
                                    dest: 0,
                                    type: 'S',
                                    seq: win.sequence,
                                    ts: String(Math.floor(Date.now() / 1000)),
                                    ttl: 3,
                                    fields: [
                                      { key: `S${win.nodeId}.TEMP`, value: (23.5 + win.windowIndex).toFixed(1) },
                                      { key: `S${win.nodeId}.TS`, value: String(Math.floor(Date.now() / 1000)) },
                                    ],
                                  },
                                  true
                                )
                              }
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--t-ink)] bg-[var(--t-surface-alt)] hover:bg-[var(--t-surface-hover)] border border-[var(--t-border-soft)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                phase && transferFlow?.triggerKey === `tx-${win.windowIndex}`
                                  ? `glow-send-btn-${phase}`
                                  : ''
                              }`}
                            >
                              <Send className="w-3 h-3" />
                              Send Node {win.nodeId} Sensor
                            </button>
                          )}

                          {canSendBack && (
                            <button
                              onClick={() => sendAckBack(win.windowIndex)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--t-teal)] bg-[var(--t-teal-soft)] border border-[var(--t-teal-border)] hover:bg-[var(--t-surface-hover)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                phase && transferFlow?.triggerKey === `ack-${win.windowIndex}`
                                  ? `glow-send-btn-${phase}`
                                  : ''
                              }`}
                            >
                              <ArrowLeftRight className="w-3 h-3" />
                              Send ACK → W{win.windowIndex - 1}
                            </button>
                          )}

                          {win.lastRxPacket?.type === 'A' &&
                            win.windowIndex > 1 &&
                            win.lastRxPacket.ttl > 0 && (
                              <button
                                onClick={() => forwardFromWindow(win.windowIndex, 'prev')}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--t-cobalt)] bg-[var(--t-cobalt-soft)] border border-[var(--t-cobalt-border)] hover:bg-[var(--t-accent-soft)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                  phase && transferFlow?.triggerKey === `fwd-${win.windowIndex}`
                                    ? `glow-send-btn-${phase}`
                                    : ''
                                }`}
                              >
                                <ArrowLeftRight className="w-3 h-3" />
                                Forward ACK → W{win.windowIndex - 1} (TTL {win.lastRxPacket.ttl - 1})
                              </button>
                            )}
                        </div>

                        {/* Last TX Sent Trace (Send Data Column — present across all 4 windows for audit & ACK verification) */}
                        {win.lastTxTrace ? (
                          <div
                            className={`border border-[var(--t-accent-border)] rounded-lg p-2.5 bg-[var(--t-teal-soft)]/60 space-y-1.5 transition-shadow ${
                              isSending && phase ? `glow-tx-col-${phase}` : ''
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span className="font-medium text-[var(--t-ink)]">
                                Last TX Sent ·{' '}
                                <span className="font-mono text-[var(--t-teal)]">
                                  {win.lastTxTrace.actionLabel}()
                                </span>{' '}
                                → {win.lastTxTrace.targetWindows.map((t) => `W${t}`).join(', ') || 'None'}
                              </span>
                              <span className="font-mono text-[11px] tabular-nums">
                                {win.lastTxTrace.ackStatus === 'verified' ? (
                                  <span className="text-[var(--t-emerald)] font-semibold">
                                    ACK Verified by W{win.lastTxTrace.ackedByWindow} (*{win.lastTxTrace.ackCrcHex})
                                  </span>
                                ) : win.lastTxTrace.ackStatus === 'pending' ? (
                                  <span className="text-[var(--t-accent)] font-medium">
                                    Awaiting ACK · SEQ {win.lastTxTrace.packet.seq} · CRC *{win.lastTxTrace.crcHex}
                                  </span>
                                ) : (
                                  <span className="text-[var(--t-cobalt)] font-medium">
                                    ACK Sent · ACK_SEQ={getFieldString(win.lastTxTrace.packet, 'ACK_SEQ') ?? '?'} · CRC *{win.lastTxTrace.crcHex}
                                  </span>
                                )}
                              </span>
                            </div>
                            <div
                              className={`flex items-center justify-between gap-2 bg-[var(--t-code-bg)] border border-[var(--t-accent-border)] text-[var(--t-ink)] font-mono text-[11px] px-2.5 py-1.5 rounded-md ${
                                isSending && phase ? `glow-tx-col-${phase}` : ''
                              }`}
                            >
                              <span className="break-all">{win.lastTxTrace.rawFrame}</span>
                              <button
                                onClick={() => navigator.clipboard?.writeText(win.lastTxTrace!.rawFrame)}
                                title="Copy transmitted frame"
                                className="text-[var(--t-ink-soft)] hover:text-[var(--t-ink)] shrink-0 cursor-pointer"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-[var(--t-ink-soft)] font-mono tabular-nums">
                              <span>
                                Sent at {win.lastTxTrace.timeLabel} · {win.lastTxTrace.rawFrame.length} B · SRC={win.lastTxTrace.packet.src} · SEQ={win.lastTxTrace.packet.seq}
                              </span>
                              <span>TX Ledger: {win.sentTraces.length} traced</span>
                            </div>
                          </div>
                        ) : (
                          <div className="px-3 py-2 text-xs text-[var(--t-ink-soft)] bg-[var(--t-surface-alt)] border border-dashed border-[var(--t-border)] rounded-lg">
                            TX Trace: No frame transmitted from Window {win.windowIndex} yet.
                          </div>
                        )}

                        {/* TX Queue Display */}
                        {win.txQueue.length > 0 && (
                          <div
                            className={`border border-[var(--t-accent-border)] rounded-lg p-2.5 bg-[var(--t-surface-alt)] space-y-1.5 ${
                              isSending && phase ? `glow-tx-col-${phase}` : ''
                            }`}
                          >
                            <div className="flex items-center justify-between text-xs font-medium text-[var(--t-ink-muted)]">
                              <span>FreeRTOS TX Queue ({win.txQueue.length} / {limits.txQueueDepth})</span>
                              <span className="font-mono text-[11px]">FIFO</span>
                            </div>
                            {win.txQueue.map((q) => (
                              <div
                                key={q.id}
                                className={`flex items-center justify-between gap-2 text-[11px] font-mono bg-[var(--t-surface)] border border-[var(--t-accent-border)] rounded px-2 py-1 ${
                                  isSending && phase ? `glow-tx-col-${phase}` : ''
                                }`}
                              >
                                <span className="truncate text-[var(--t-ink)]">{q.rawFrame}</span>
                                <span className="text-[var(--t-cobalt)] shrink-0">→ W{q.targetWindows.join(',W')}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Manual Raw Frame Injection into this Window's pollReceive() */}
                        <div className="pt-2 border-t border-[var(--t-border-soft)] flex items-center gap-2">
                          <input
                            type="text"
                            value={customRawInputs[win.windowIndex] ?? ''}
                            onChange={(e) =>
                              setCustomRawInputs((prev) => ({
                                ...prev,
                                [win.windowIndex]: e.target.value,
                              }))
                            }
                            placeholder={`Inject raw frame into W${win.windowIndex} pollReceive()...`}
                            className={`flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono bg-[var(--t-surface-alt)] border border-[var(--t-emerald-border)] rounded-md text-[var(--t-ink)] placeholder:text-[var(--t-ink-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--t-accent)]/25 focus:border-[var(--t-accent)] ${
                              phase && transferFlow?.triggerKey === `inject-${win.windowIndex}`
                                ? `glow-rx-col-${phase}`
                                : ''
                            }`}
                          />
                          <button
                            onClick={() => {
                              const raw = customRawInputs[win.windowIndex] ?? '';
                              if (raw.trim()) {
                                deliverFrameToWindow(win.windowIndex, raw, null, 'Manual RX inject');
                              }
                            }}
                            className={`px-2.5 py-1.5 text-xs font-medium text-[var(--t-ink)] bg-[var(--t-surface)] border border-[var(--t-border)] rounded-md hover:bg-[var(--t-surface-alt)] whitespace-nowrap shrink-0 cursor-pointer ${
                              phase && transferFlow?.triggerKey === `inject-${win.windowIndex}`
                                ? `glow-send-btn-${phase}`
                                : ''
                            }`}
                          >
                            RX Inject
                          </button>
                        </div>
                      </>
                    )}

                    {win.activeTab === 'fields' && (
                      <div className="space-y-3">
                        <div className="text-xs text-[var(--t-ink-muted)] flex flex-wrap items-center justify-between gap-2">
                          <span>
                            App subscribes to:{' '}
                            <span className="font-mono text-[var(--t-ink)]">
                              {win.knownKeys.join(', ')}
                            </span>
                          </span>
                          <span className="text-[var(--t-ink-soft)]">
                            Unknown fields preserved without rejection
                          </span>
                        </div>

                        {win.lastRxPacket ? (
                          <div
                            className={`border border-[var(--t-cobalt-border)] rounded-lg overflow-x-auto ${
                              isReceiving && phase ? `glow-interpret-col-${phase}` : ''
                            }`}
                          >
                            <table className="w-full text-xs">
                              <thead className="bg-[var(--t-cobalt-soft)] border-b border-[var(--t-cobalt-border)] text-[var(--t-cobalt)]">
                                <tr>
                                  <th className="text-left font-medium px-3 py-2">Key</th>
                                  <th className="text-left font-medium px-3 py-2">Raw Value</th>
                                  <th className="text-left font-medium px-3 py-2">Typed Parse</th>
                                  <th className="text-right font-medium px-3 py-2">App Handling</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[var(--t-border-soft)] font-mono">
                                {win.lastRxPacket.fields.map((f, idx) => {
                                  const isKnown = win.knownKeys.includes(f.key);
                                  const asFloat = getFieldFloat(win.lastRxPacket!, f.key);
                                  const asInt = getFieldInt(win.lastRxPacket!, f.key);
                                  return (
                                    <tr key={`${f.key}-${idx}`} className="hover:bg-[var(--t-surface-alt)]/70">
                                      <td className="px-3 py-2 font-semibold text-[var(--t-ink)]">{f.key}</td>
                                      <td className="px-3 py-2 text-[var(--t-ink-muted)]">{f.value}</td>
                                      <td className="px-3 py-2 bg-[var(--t-cobalt-soft)]/35 text-[var(--t-cobalt)]">
                                        {asInt !== null
                                          ? `int32(${asInt})`
                                          : asFloat !== null
                                          ? `float(${asFloat})`
                                          : `str("${f.value}")`}
                                      </td>
                                      <td className="px-3 py-2 text-right font-sans bg-[var(--t-cobalt-soft)]/35">
                                        {isKnown ? (
                                          <span className="text-emerald-700 font-medium">
                                            Extracted
                                          </span>
                                        ) : (
                                          <span className="text-[var(--t-ink-soft)]">
                                            Preserved (Ignored)
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="px-3 py-6 text-xs text-[var(--t-ink-soft)] bg-[var(--t-surface-alt)] border border-dashed border-[var(--t-border)] rounded-lg text-center">
                            Receive a packet in Window {win.windowIndex} to inspect key=value extraction.
                          </div>
                        )}
                      </div>
                    )}

                    {win.activeTab === 'log' && (
                      <div className="space-y-2">
                        {win.logs.length === 0 ? (
                          <div className="px-3 py-6 text-xs text-[var(--t-ink-soft)] bg-[var(--t-surface-alt)] border border-dashed border-[var(--t-border)] rounded-lg text-center">
                            No UART activity recorded in Window {win.windowIndex} yet.
                          </div>
                        ) : (
                          <div className="max-h-64 overflow-y-auto divide-y divide-[var(--t-border-soft)] border border-[var(--t-border)] rounded-lg">
                            {win.logs.map((entry, logIdx) => {
                              const isTxEntry = entry.kind === 'TX' || entry.kind === 'FWD';
                              const isRxEntry =
                                entry.kind === 'RX_OK' ||
                                entry.kind === 'ACK_OK' ||
                                entry.kind === 'ACK_FAIL' ||
                                entry.kind === 'RX_ERR';
                              const logGlow =
                                logIdx === 0 && phase
                                  ? isTxEntry && isSending
                                    ? `glow-tx-col-${phase} bg-amber-50/40`
                                    : isRxEntry && isReceiving
                                    ? `glow-rx-col-${phase} bg-emerald-50/40`
                                    : ''
                                  : '';
                              return (
                                <div key={entry.id} className={`px-3 py-2 text-xs space-y-1 ${logGlow}`}>
                                  <div className="flex items-center justify-between gap-2">
                                    <span
                                      className={`font-mono font-semibold ${
                                        entry.kind === 'RX_OK' || entry.kind === 'TX' || entry.kind === 'FWD' || entry.kind === 'ACK_OK'
                                          ? 'text-emerald-700'
                                          : entry.kind === 'DROP_DUP' || entry.kind === 'DROP_TTL' || entry.kind === 'QUEUE_FULL' || entry.kind === 'ACK_FAIL'
                                          ? 'text-amber-800'
                                          : entry.kind === 'REBOOT'
                                          ? 'text-[var(--t-accent)]'
                                          : 'text-red-700'
                                      }`}
                                    >
                                      {entry.kind}
                                    </span>
                                    <span className="font-mono text-[11px] text-[var(--t-ink-soft)] tabular-nums">
                                      {entry.timeLabel}
                                    </span>
                                  </div>
                                  <div className="text-[var(--t-ink-muted)]">{entry.summary}</div>
                                  {entry.rawFrame && (
                                    <div className="flex items-center justify-between gap-2 bg-[var(--t-code-bg)] border border-[var(--t-border)] text-[var(--t-ink)] font-mono text-[11px] px-2 py-1 rounded">
                                      <span className="truncate">{entry.rawFrame}</span>
                                      <button
                                        onClick={() => navigator.clipboard?.writeText(entry.rawFrame!)}
                                        title="Copy raw frame"
                                        className="text-[var(--t-ink-soft)] hover:text-[var(--t-ink)] shrink-0 cursor-pointer"
                                      >
                                        <Copy className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
};
