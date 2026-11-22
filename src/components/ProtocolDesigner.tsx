import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  AlertTriangle,
  XCircle,
  Loader2,
} from 'lucide-react';
import { ScrollingTitle } from './ScrollingTitle';
import {
  generateFrameCreationRulesForLlm,
  generateInoSnippet,
} from '../protocol/cppGenerator';
import {
  computeSramFootprint,
  DEFAULT_LIMITS,
  encodeFrame,
  PACKET_PRESETS,
  parseFrame,
  ProtocolLimits,
  SafeCsvPacket,
} from '../protocol/safeCsvEngine';

interface ProtocolDesignerProps {
  packet: SafeCsvPacket;
  onChangePacket: (pkt: SafeCsvPacket) => void;
  limits: ProtocolLimits;
  onChangeLimits: (limits: ProtocolLimits) => void;
  onTestInFourWindows: () => void;
}

export const ProtocolDesigner: React.FC<ProtocolDesignerProps> = ({
  packet,
  onChangePacket,
  limits,
  onChangeLimits,
  onTestInFourWindows,
}) => {
  const [rawTestInput, setRawTestInput] = useState<string>(
    '<1,2,0,S,101,1732183005,3,7,CO2=480,HUM=65.5,TEMP=24.2,PRESS=1013.2,S7.CO2=510,S7.TS=1732183004,DOOR=1*0000>'
  );
  const [copiedWire, setCopiedWire] = useState(false);
  const [exportTab, setExportTab] = useState<'ino' | 'rules' | 'ai'>('ino');
  const [copiedExport, setCopiedExport] = useState(false);
  const [aiPrompt, setAiPrompt] = useState(
    'Read DHT22 humidity/temp and MH-Z19 CO2 every 5s on ESP32 Node 2, broadcast via Serial1, and switch GPIO 26 relay when RELAY1=1.'
  );
  const [aiInoCode, setAiInoCode] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [designerGlow, setDesignerGlow] = useState<{
    scope: 'all' | 'encode' | 'bench';
    nonce: number;
  } | null>({ scope: 'all', nonce: 1 });
  const glowNonceRef = useRef<number>(1);
  const glowTimerRef = useRef<number | null>(null);

  const triggerDesignerGlow = (scope: 'all' | 'encode' | 'bench') => {
    if (glowTimerRef.current !== null) {
      window.clearTimeout(glowTimerRef.current);
    }
    glowNonceRef.current += 1;
    setDesignerGlow({ scope, nonce: glowNonceRef.current });
    glowTimerRef.current = window.setTimeout(() => {
      setDesignerGlow(null);
      glowTimerRef.current = null;
    }, 2150);
  };

  useEffect(() => {
    glowTimerRef.current = window.setTimeout(() => {
      setDesignerGlow(null);
      glowTimerRef.current = null;
    }, 2150);
    return () => {
      if (glowTimerRef.current !== null) {
        window.clearTimeout(glowTimerRef.current);
      }
    };
  }, []);

  const encoded = useMemo(() => encodeFrame(packet, limits), [packet, limits]);
  const parsedBench = useMemo(
    () => parseFrame(rawTestInput, limits),
    [rawTestInput, limits]
  );
  const inoCode = useMemo(() => generateInoSnippet(packet, limits), [packet, limits]);
  const llmRules = useMemo(
    () => generateFrameCreationRulesForLlm(packet, limits),
    [packet, limits]
  );
  const sram = useMemo(() => computeSramFootprint(limits), [limits]);

  const bufferPct = Math.min(100, Math.round((encoded.byteLength / limits.maxFrameLen) * 100));

  const updateHeader = <K extends keyof SafeCsvPacket>(key: K, value: SafeCsvPacket[K]) => {
    onChangePacket({ ...packet, [key]: value });
    triggerDesignerGlow('encode');
  };

  const addField = (presetKey = '', presetVal = '') => {
    const nextIdx = packet.fields.length + 1;
    onChangePacket({
      ...packet,
      fields: [
        ...packet.fields,
        {
          key: presetKey || `S${nextIdx}.VAL`,
          value: presetVal || '0',
        },
      ],
    });
    triggerDesignerGlow('encode');
  };

  const updateField = (idx: number, prop: 'key' | 'value', val: string) => {
    const next = packet.fields.map((f, i) => (i === idx ? { ...f, [prop]: val } : f));
    onChangePacket({ ...packet, fields: next });
    triggerDesignerGlow('encode');
  };

  const removeField = (idx: number) => {
    onChangePacket({
      ...packet,
      fields: packet.fields.filter((_, i) => i !== idx),
    });
    triggerDesignerGlow('encode');
  };

  const copyEncodedWire = () => {
    navigator.clipboard?.writeText(encoded.frame);
    setCopiedWire(true);
    setTimeout(() => setCopiedWire(false), 1500);
  };

  const activeExportText =
    exportTab === 'ino' ? inoCode : exportTab === 'rules' ? llmRules : aiInoCode;

  const copyExportText = () => {
    if (!activeExportText) return;
    navigator.clipboard?.writeText(activeExportText);
    setCopiedExport(true);
    setTimeout(() => setCopiedExport(false), 1500);
  };

  const downloadInoFile = (code: string, filename = 'SafeCsvNode.ino') => {
    if (!code) return;
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleGenerateAiIno = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const resp = await fetch('/api/generate-ino', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPrompt: aiPrompt,
          rulesText: llmRules,
          currentPacket: packet,
          limits,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || `Request failed (${resp.status})`);
      }
      setAiInoCode(data.code || '');
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to generate .ino code.');
    } finally {
      setAiLoading(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 text-xs font-mono bg-[var(--t-surface-alt)] border border-[var(--t-border)] rounded-lg text-[var(--t-ink)] tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--t-accent)]/25 focus:border-[var(--t-accent)]';

  const phase = designerGlow ? (designerGlow.nonce % 2 === 0 ? 'a' : 'b') : null;
  const encodeActive = Boolean(phase && (designerGlow?.scope === 'all' || designerGlow?.scope === 'encode'));
  const benchActive = Boolean(phase && (designerGlow?.scope === 'all' || designerGlow?.scope === 'bench'));

  return (
    <div className="space-y-6">
      {/* Top Action & Preset Strip */}
      <div className="bg-[var(--t-surface)] border border-[var(--t-border)] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <ScrollingTitle as="h1" className="text-lg font-semibold text-[var(--t-ink)]">
            Protocol Packet &amp; Compile-Time Designer
          </ScrollingTitle>
          <p className="text-sm text-[var(--t-ink-muted)] mt-0.5">
            Separate fixed communication headers from variable KEY=VALUE sensor payloads and size ESP32 SRAM buffers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {PACKET_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => {
                onChangePacket(preset.packet);
                triggerDesignerGlow('encode');
              }}
              className="px-3 py-1.5 text-xs font-medium text-[var(--t-ink)] bg-[var(--t-surface-alt)] hover:bg-[var(--t-surface-hover)] border border-[var(--t-border-soft)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {preset.label}
            </button>
          ))}
          <button
            onClick={onTestInFourWindows}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[var(--t-accent)] hover:bg-[var(--t-accent-hover)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              encodeActive && phase ? `glow-send-btn-${phase}` : ''
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            Load into 4-Window Bus
          </button>
        </div>
      </div>

      {/* Main 2-Column Design Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Cols: Fixed Header + Variable Payload Builder */}
        <div className="lg:col-span-7 space-y-6">
          {/* Fixed Header Editor */}
          <section
            className={`bg-[var(--t-surface)] border-[6px] border-dotted border-[#1D4ED8] rounded-xl p-5 space-y-4 ${
              encodeActive && phase ? `glow-interpret-col-${phase}` : ''
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <ScrollingTitle as="h2" className="text-sm font-semibold text-[var(--t-ink)]">
                  1. Fixed Communication Header (8 Fields)
                </ScrollingTitle>
                <p className="text-xs text-[var(--t-ink-muted)] mt-0.5">
                  Routing, sequence tracking, 64-bit timestamp, TTL, and payload field count.
                </p>
              </div>
              <span
                className={`font-mono text-xs font-semibold text-[var(--t-cobalt)] bg-[var(--t-cobalt-soft)] border border-[var(--t-cobalt-border)] px-2 py-0.5 rounded tabular-nums ${
                  encodeActive && phase ? `glow-interpret-col-${phase}` : ''
                }`}
              >
                COUNT = {packet.fields.length}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--t-ink-muted)] mb-1">VERSION</label>
                <input
                  type="number"
                  min={1}
                  max={255}
                  value={packet.version}
                  onChange={(e) => updateHeader('version', Number(e.target.value) || 1)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--t-ink-muted)] mb-1">
                  SRC (1..{limits.maxNodeId})
                </label>
                <input
                  type="number"
                  min={1}
                  max={limits.maxNodeId}
                  value={packet.src}
                  onChange={(e) => updateHeader('src', Number(e.target.value) || 1)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--t-ink-muted)] mb-1">
                  DEST (0=All)
                </label>
                <input
                  type="number"
                  min={0}
                  max={limits.maxNodeId}
                  value={packet.dest}
                  onChange={(e) => updateHeader('dest', Number(e.target.value) || 0)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--t-ink-muted)] mb-1">TYPE</label>
                <select
                  value={packet.type}
                  onChange={(e) => updateHeader('type', e.target.value)}
                  className={inputClass}
                >
                  <option value="S">S (Status)</option>
                  <option value="C">C (Control)</option>
                  <option value="A">A (Ack)</option>
                  <option value="H">H (Heartbeat)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--t-ink-muted)] mb-1">
                  SEQ (16-bit)
                </label>
                <input
                  type="number"
                  min={0}
                  max={65535}
                  value={packet.seq}
                  onChange={(e) => updateHeader('seq', Number(e.target.value) || 0)}
                  className={inputClass}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[var(--t-ink-muted)] mb-1">
                  TS (64-bit Timestamp)
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={packet.ts}
                    onChange={(e) => updateHeader('ts', e.target.value.replace(/\D/g, ''))}
                    className={`flex-1 min-w-0 ${inputClass}`}
                  />
                  <button
                    onClick={() => updateHeader('ts', String(Math.floor(Date.now() / 1000)))}
                    className="px-2.5 py-2 text-xs font-medium text-[var(--t-ink)] bg-[var(--t-surface-alt)] hover:bg-[var(--t-surface-hover)] border border-[var(--t-border-soft)] rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Now
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--t-ink-muted)] mb-1">TTL</label>
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={packet.ttl}
                  onChange={(e) => updateHeader('ttl', Number(e.target.value) || 0)}
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          {/* Variable KEY=VALUE Sensor Fields */}
          <section
            className={`bg-[var(--t-surface)] border-[6px] border-dotted border-[#047857] rounded-xl p-5 space-y-4 ${
              encodeActive && phase ? `glow-interpret-col-${phase}` : ''
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <ScrollingTitle as="h2" className="text-sm font-semibold text-[var(--t-ink)]">
                  2. Variable KEY=VALUE Sensor Payload
                </ScrollingTitle>
                <p className="text-xs text-[var(--t-ink-muted)] mt-0.5">
                  Add new sensors or namespaced IDs (e.g. S7.CO2, S7.TS) without modifying CsvProtocol.h.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => addField('PRESS', '1013.2')}
                  className="px-2.5 py-1.5 text-xs font-medium text-[var(--t-ink)] bg-[var(--t-surface-alt)] hover:bg-[var(--t-surface-hover)] border border-[var(--t-border-soft)] rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                >
                  + PRESS
                </button>
                <button
                  onClick={() => addField('S7.CO2', '510')}
                  className="px-2.5 py-1.5 text-xs font-medium text-[var(--t-ink)] bg-[var(--t-surface-alt)] hover:bg-[var(--t-surface-hover)] border border-[var(--t-border-soft)] rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                >
                  + S7.CO2
                </button>
                <button
                  onClick={() => addField()}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[var(--t-accent-ink)] bg-[var(--t-accent-soft)] hover:bg-[var(--t-accent-soft-hover)] border border-[var(--t-accent-border)] rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Field
                </button>
              </div>
            </div>

            <div
              className={`border border-[var(--t-cobalt-border)] rounded-lg overflow-x-auto ${
                encodeActive && phase ? `glow-interpret-col-${phase}` : ''
              }`}
            >
              <table className="w-full text-xs">
                <thead className="bg-[var(--t-surface-alt)] border-b border-[var(--t-border)] text-[var(--t-ink-muted)]">
                  <tr>
                    <th className="text-left font-medium px-3 py-2 w-10">#</th>
                    <th className="text-left font-medium px-3 py-2">
                      Key (max {limits.maxKeyLen})
                    </th>
                    <th className="text-left font-medium px-3 py-2">
                      Value (max {limits.maxValLen})
                    </th>
                    <th className="text-right font-medium px-3 py-2 w-20">Length</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--t-border-soft)]">
                  {packet.fields.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-[var(--t-ink-soft)]">
                        No payload fields. Click &ldquo;Add Field&rdquo; to attach sensor data.
                      </td>
                    </tr>
                  ) : (
                    packet.fields.map((field, idx) => {
                      const keyOver = field.key.length > limits.maxKeyLen;
                      const valOver = field.value.length > limits.maxValLen;
                      return (
                        <tr key={idx} className="hover:bg-[var(--t-surface-alt)]/60">
                          <td className="px-3 py-2 font-mono text-[var(--t-ink-soft)] tabular-nums">
                            {idx + 1}
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              type="text"
                              value={field.key}
                              onChange={(e) => updateField(idx, 'key', e.target.value)}
                              className={`w-full px-2.5 py-1.5 font-mono text-xs border rounded-md focus:outline-none focus:ring-2 ${
                                keyOver
                                  ? 'bg-red-50 border-red-300 text-red-900 focus:ring-red-500/20'
                                  : 'bg-[var(--t-surface)] border-[var(--t-border)] text-[var(--t-ink)] focus:ring-[var(--t-accent)]/25 focus:border-[var(--t-accent)]'
                              }`}
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              type="text"
                              value={field.value}
                              onChange={(e) => updateField(idx, 'value', e.target.value)}
                              className={`w-full px-2.5 py-1.5 font-mono text-xs border rounded-md focus:outline-none focus:ring-2 ${
                                valOver
                                  ? 'bg-red-50 border-red-300 text-red-900 focus:ring-red-500/20'
                                  : 'bg-[var(--t-surface)] border-[var(--t-border)] text-[var(--t-ink)] focus:ring-[var(--t-accent)]/25 focus:border-[var(--t-accent)]'
                              }`}
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[11px] text-[var(--t-ink-soft)] tabular-nums">
                            {field.key.length}/{field.value.length}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <button
                              onClick={() => removeField(idx)}
                              title="Remove field"
                              className="p-1.5 text-[var(--t-ink-soft)] hover:text-red-700 rounded transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Live Encoded Wire Frame & CRC-16 Dissector (Send Data Column) */}
          <section
            className={`bg-[var(--t-surface)] border-[6px] border-dotted border-[#D97706] rounded-xl p-5 space-y-3 ${
              encodeActive && phase ? `glow-tx-col-${phase}` : ''
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <ScrollingTitle as="h2" className="text-sm font-semibold text-[var(--t-ink)]">
                  3. Wire Frame Output &amp; CRC-16/CCITT-FALSE
                </ScrollingTitle>
                <p className="text-xs text-[var(--t-ink-muted)] mt-0.5">
                  Polynomial 0x1021 · Init 0xFFFF · {encoded.byteLength} / {limits.maxFrameLen} bytes ({bufferPct}%)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setRawTestInput(encoded.frame);
                    triggerDesignerGlow('bench');
                  }}
                  className={`px-2.5 py-1.5 text-xs font-medium text-[var(--t-ink)] bg-[var(--t-surface-alt)] hover:bg-[var(--t-surface-hover)] border border-[var(--t-border-soft)] rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                    benchActive && phase ? `glow-send-btn-${phase}` : ''
                  }`}
                >
                  Load into Parser Bench
                </button>
                <button
                  onClick={copyEncodedWire}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[var(--t-ink)] bg-[var(--t-surface)] border border-[var(--t-border)] hover:bg-[var(--t-surface-alt)] rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedWire ? 'Copied' : 'Copy Frame'}
                </button>
              </div>
            </div>

            <div
              className={`bg-[var(--t-code-bg)] border border-[var(--t-accent-border)] text-[var(--t-ink)] rounded-lg p-3.5 font-mono text-xs break-all leading-relaxed ${
                encodeActive && phase ? `glow-tx-col-${phase}` : ''
              }`}
            >
              <span className="text-[var(--t-syntax-delim)] font-semibold">&lt;</span>
              <span className="text-[var(--t-syntax-hdr)]">
                {packet.version},{packet.src},{packet.dest},{packet.type},{packet.seq},{packet.ts},{packet.ttl},{packet.fields.length}
              </span>
              {packet.fields.length > 0 && (
                <span className="text-[var(--t-syntax-payload)]">
                  ,{packet.fields.map((f) => `${f.key}=${f.value}`).join(',')}
                </span>
              )}
              <span className="text-[var(--t-syntax-delim)] font-semibold">*{encoded.crcHex}&gt;</span>
            </div>

            {/* Frame Buffer Utilization Bar */}
            <div className="w-full bg-[var(--t-surface-alt)] h-2 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  bufferPct > 90 ? 'bg-red-600' : bufferPct > 70 ? 'bg-amber-600' : 'bg-[var(--t-accent)]'
                }`}
                style={{ width: `${bufferPct}%` }}
              />
            </div>

            {encoded.issues.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {encoded.issues.map((issue, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${
                      issue.severity === 'error'
                        ? 'bg-red-50 border-red-200 text-red-900'
                        : 'bg-amber-50 border-amber-200 text-amber-900'
                    }`}
                  >
                    {issue.severity === 'error' ? (
                      <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    )}
                    <span>{issue.message}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 4. ESP32 .ino Frame Builder & LLM Rules */}
          <section className="bg-[var(--t-surface)] border-[6px] border-dotted border-[#7C3AED] rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <ScrollingTitle as="h2" className="text-sm font-semibold text-[var(--t-ink)]">
                  4. ESP32 .ino Code &amp; LLM Frame Rules
                </ScrollingTitle>
                <p className="text-xs text-[var(--t-ink-muted)] mt-0.5">
                  Copy ready-to-compile .ino code, paste frame-creation rules into an LLM, or generate custom firmware.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={copyExportText}
                  disabled={!activeExportText}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[var(--t-ink)] bg-[var(--t-surface)] border border-[var(--t-border)] hover:bg-[var(--t-surface-alt)] disabled:opacity-40 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedExport ? 'Copied' : exportTab === 'rules' ? 'Copy LLM Rules' : 'Copy .ino'}
                </button>
                {(exportTab === 'ino' || (exportTab === 'ai' && aiInoCode)) && (
                  <button
                    onClick={() =>
                      downloadInoFile(
                        exportTab === 'ino' ? inoCode : aiInoCode,
                        `SafeCsvNode${packet.src}.ino`
                      )
                    }
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[var(--t-accent-ink)] bg-[var(--t-accent-soft)] hover:bg-[var(--t-accent-soft-hover)] border border-[var(--t-accent-border)] rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download .ino
                  </button>
                )}
              </div>
            </div>

            <div className="inline-flex items-center gap-1 p-1 bg-[var(--t-surface-alt)] border border-[var(--t-border-soft)] rounded-lg">
              <button
                onClick={() => setExportTab('ino')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  exportTab === 'ino'
                    ? 'bg-[var(--t-surface)] text-[var(--t-ink)] shadow-xs'
                    : 'text-[var(--t-ink-muted)] hover:text-[var(--t-ink)]'
                }`}
              >
                Arduino .ino Snippet
              </button>
              <button
                onClick={() => setExportTab('rules')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  exportTab === 'rules'
                    ? 'bg-[var(--t-surface)] text-[var(--t-ink)] shadow-xs'
                    : 'text-[var(--t-ink-muted)] hover:text-[var(--t-ink)]'
                }`}
              >
                Frame Rules &amp; LLM Prompt
              </button>
              <button
                onClick={() => setExportTab('ai')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  exportTab === 'ai'
                    ? 'bg-[var(--t-surface)] text-[var(--t-ink)] shadow-xs'
                    : 'text-[var(--t-ink-muted)] hover:text-[var(--t-ink)]'
                }`}
              >
                Generate .ino with LLM
              </button>
            </div>

            {exportTab === 'ai' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[var(--t-ink)]">
                    Describe your ESP32 sensors, pins, UART wiring, and relay/control logic
                  </label>
                  <textarea
                    rows={3}
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="e.g. Read BME280 on I2C and send CO2, TEMP, HUM, PRESS every 5 seconds..."
                    className="w-full px-3 py-2 text-xs bg-[var(--t-surface-alt)] border border-[var(--t-border)] rounded-lg text-[var(--t-ink)] placeholder:text-[var(--t-ink-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--t-accent)]/25 focus:border-[var(--t-accent)]"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-[var(--t-ink-muted)]">
                    Uses your active {limits.maxFields}-field limits and current packet schema as context.
                  </span>
                  <button
                    onClick={handleGenerateAiIno}
                    disabled={aiLoading || !aiPrompt.trim()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[var(--t-accent)] hover:bg-[var(--t-accent-hover)] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {aiLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {aiLoading ? 'Generating .ino...' : 'Generate ESP32 .ino'}
                  </button>
                </div>
                {aiError && (
                  <div className="px-3 py-2.5 text-xs bg-red-50 border border-red-200 text-red-900 rounded-lg flex items-start gap-2">
                    <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <span>{aiError}</span>
                  </div>
                )}
              </div>
            )}

            {exportTab !== 'ai' || aiInoCode ? (
              <div className="bg-[var(--t-code-bg)] border border-[var(--t-border)] rounded-lg overflow-hidden">
                <div className="px-3.5 py-2 bg-[var(--t-teal-soft)] border-b border-[var(--t-teal-border)] flex items-center justify-between text-xs text-[var(--t-teal)] font-mono">
                  <span>
                    {exportTab === 'ino'
                      ? `SafeCsvNode${packet.src}.ino`
                      : exportTab === 'rules'
                      ? 'SafeCsv_Frame_Rules_LLM_Prompt.txt'
                      : `Generated_SafeCsvNode${packet.src}.ino`}
                  </span>
                  <span className="tabular-nums">
                    {activeExportText.split('\n').length} lines
                  </span>
                </div>
                <pre className="p-3.5 text-xs font-mono text-[var(--t-ink)] overflow-x-auto max-h-96 leading-relaxed">
                  <code>{activeExportText}</code>
                </pre>
              </div>
            ) : (
              <div className="px-4 py-6 text-xs text-[var(--t-ink-soft)] bg-[var(--t-surface-alt)] border border-dashed border-[var(--t-border)] rounded-lg text-center">
                Enter your ESP32 hardware requirements above and click &ldquo;Generate ESP32 .ino&rdquo; to produce a full sketch using SafeCsv rules.
              </div>
            )}
          </section>
        </div>

        {/* Right 5 Cols: Compile-Time Limits + SRAM Estimator + Raw Parser Bench */}
        <div className="lg:col-span-5 space-y-6">
          {/* Compile-Time Limits Configurator */}
          <section className="bg-[var(--t-surface)] border-[6px] border-dotted border-[#E11D48] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <ScrollingTitle as="h2" className="text-sm font-semibold text-[var(--t-ink)]">
                  Compile-Time Limits (CsvProtocol.h)
                </ScrollingTitle>
                <p className="text-xs text-[var(--t-ink-muted)] mt-0.5">
                  Configure static bounds; reflected directly in the generated C++ header.
                </p>
              </div>
              <button
                onClick={() => onChangeLimits(DEFAULT_LIMITS)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[var(--t-ink)] bg-[var(--t-surface-alt)] hover:bg-[var(--t-surface-hover)] border border-[var(--t-border-soft)] rounded-md whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Defaults
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'maxFields', label: 'Maximum sensor fields', min: 1, max: 64 },
                { key: 'maxKeyLen', label: 'Key length (chars)', min: 4, max: 64 },
                { key: 'maxValLen', label: 'Value length (chars)', min: 4, max: 128 },
                { key: 'maxFrameLen', label: 'Frame buffer (bytes)', min: 128, max: 4096 },
                { key: 'txQueueDepth', label: 'TX queue depth (frames)', min: 1, max: 16 },
                { key: 'frameTimeoutMs', label: 'Frame timeout (ms)', min: 50, max: 5000 },
                { key: 'maxNodeId', label: 'Maximum node ID', min: 3, max: 254 },
              ].map((cfg) => (
                <div key={cfg.key}>
                  <label className="block text-xs font-medium text-[var(--t-ink-muted)] mb-1">
                    {cfg.label}
                  </label>
                  <input
                    type="number"
                    min={cfg.min}
                    max={cfg.max}
                    value={limits[cfg.key as keyof ProtocolLimits]}
                    onChange={(e) =>
                      onChangeLimits({
                        ...limits,
                        [cfg.key]: Math.max(cfg.min, Number(e.target.value) || cfg.min),
                      })
                    }
                    className={inputClass}
                  />
                </div>
              ))}
            </div>

            {/* ESP32 Static SRAM Footprint Breakdown */}
            <div className="pt-3 border-t border-[var(--t-border-soft)] space-y-2">
              <div className="text-xs font-semibold text-[var(--t-ink)]">
                Estimated ESP32 Static SRAM Footprint
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                <div className="px-3 py-2 bg-[var(--t-surface-alt)] border border-[var(--t-border-soft)] rounded-lg">
                  <div className="font-sans text-[11px] text-[var(--t-ink-soft)]">SafeCsvPacket</div>
                  <div className="font-semibold text-[var(--t-ink)]">{sram.packetStructBytes} B</div>
                </div>
                <div className="px-3 py-2 bg-[var(--t-cobalt-soft)] border border-[var(--t-cobalt-border)] rounded-lg">
                  <div className="font-sans text-[11px] text-[var(--t-cobalt)]">Single SafeCsvLink</div>
                  <div className="font-semibold text-[var(--t-ink)]">{sram.singleLinkBytes} B</div>
                </div>
                <div className="px-3 py-2 bg-[var(--t-emerald-soft)] border border-[var(--t-emerald-border)] rounded-lg">
                  <div className="font-sans text-[11px] text-[var(--t-emerald)]">Replay Tracker</div>
                  <div className="font-semibold text-[var(--t-ink)]">{sram.replayTrackerBytes} B</div>
                </div>
                <div className="px-3 py-2 bg-[var(--t-teal-soft)] border border-[var(--t-teal-border)] rounded-lg">
                  <div className="font-sans text-[11px] text-[var(--t-teal)]">Dual-UART Total</div>
                  <div className="font-semibold text-[var(--t-teal)]">
                    {(sram.dualUartTotalBytes / 1024).toFixed(2)} KB
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Raw Frame Parser & Verification Bench (Receive & Interpretation Column) */}
          <section
            className={`bg-[var(--t-surface)] border-[6px] border-dotted border-[#0284C7] rounded-xl p-5 space-y-3 ${
              benchActive && phase ? `glow-rx-col-${phase}` : ''
            }`}
          >
            <div className="min-w-0">
              <ScrollingTitle as="h2" className="text-sm font-semibold text-[var(--t-ink)]">
                Raw Frame Parser Bench
              </ScrollingTitle>
              <p className="text-xs text-[var(--t-ink-muted)] mt-0.5">
                Paste any wire string to verify framing, CRC-16/CCITT-FALSE, and limit compliance.
              </p>
            </div>

            <textarea
              rows={3}
              value={rawTestInput}
              onChange={(e) => {
                setRawTestInput(e.target.value);
                triggerDesignerGlow('bench');
              }}
              className={`w-full px-3 py-2 text-xs font-mono bg-[var(--t-surface-alt)] border border-[var(--t-emerald-border)] rounded-lg text-[var(--t-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--t-accent)]/25 focus:border-[var(--t-accent)] ${
                benchActive && phase ? `glow-rx-col-${phase}` : ''
              }`}
            />

            <div
              className={`px-3 py-2.5 rounded-lg border text-xs flex items-start gap-2 ${
                parsedBench.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              } ${benchActive && phase ? `glow-interpret-col-${phase}` : ''}`}
            >
              {parsedBench.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-semibold">{parsedBench.code}</div>
                <div className="mt-0.5">{parsedBench.message}</div>
                {parsedBench.code === 'ERR_CRC_MISMATCH' && (
                  <button
                    onClick={() => {
                      const star = rawTestInput.lastIndexOf('*');
                      if (star > 0) {
                        setRawTestInput(
                          `${rawTestInput.slice(0, star + 1)}${parsedBench.expectedCrcHex}>`
                        );
                      }
                    }}
                    className="mt-1.5 underline font-medium cursor-pointer"
                  >
                    Fix CRC to *{parsedBench.expectedCrcHex}
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
