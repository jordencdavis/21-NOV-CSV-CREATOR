import React from 'react';
import { ArrowRight } from 'lucide-react';
import { ScrollingTitle } from './ScrollingTitle';
import { ProtocolLimits } from '../protocol/safeCsvEngine';

interface ArchitectureReferenceProps {
  limits: ProtocolLimits;
  onJumpToSimulator: () => void;
}

export const ArchitectureReference: React.FC<ArchitectureReferenceProps> = ({
  limits,
  onJumpToSimulator,
}) => {
  const headerFields = [
    ['VERSION', 'Protocol version (e.g. 1)'],
    ['SRC', 'Sending ESP32 ID (1..SAFECSV_MAX_NODE_ID)'],
    ['DEST', 'Destination ESP32 ID (0 = SAFECSV_NODE_ALL)'],
    ['TYPE', 'Status (S), Control (C), Acknowledgement (A), Heartbeat (H)'],
    ['SEQ', '16-bit sequence number with rollover (0..65535)'],
    ['TS', '64-bit packet timestamp (Unix epoch seconds/ms)'],
    ['TTL', 'Forwarding limit; decremented on each queueForward() hop'],
    ['COUNT', 'Number of variable KEY=VALUE payload fields'],
  ];

  const capabilities = [
    ['Start/end framing', '< and > delimiters with automatic resynchronization'],
    ['Integrity', 'CRC-16/CCITT-FALSE (0x1021, init 0xFFFF)'],
    ['Protocol version', 'Checked in fixed header before payload decode'],
    ['Variable sensor fields', 'Named KEY=VALUE pairs; unknown fields preserved'],
    ['Sensor IDs', 'Namespaced field names (e.g. S7.CO2, S7.TS, S8.TEMP)'],
    ['Timestamps', '64-bit packet timestamp plus optional per-sensor timestamps'],
    ['Sequence tracking', '16-bit unsigned counter with clean 65535 → 0 rollover'],
    ['Duplicate detection', '32-packet sliding replay window per source node'],
    ['Reboot detection', 'Session ID rotation resets receiver replay bitmap'],
    ['Recovery', '500 ms frame timeout, < resynchronization, overflow guard'],
    ['FreeRTOS', 'Dedicated TX queue and mutex-protected sequence generation'],
    ['Routing', 'queueForward() preserves SRC, SEQ, and SID while decrementing TTL'],
  ];

  const defaultRows = [
    ['Maximum sensor fields', '16', String(limits.maxFields)],
    ['Key length', '15 characters', `${limits.maxKeyLen} characters`],
    ['Value length', '31 characters', `${limits.maxValLen} characters`],
    ['Frame buffer', '896 bytes', `${limits.maxFrameLen} bytes`],
    ['TX queue depth', '3 frames', `${limits.txQueueDepth} frames`],
    ['Frame timeout', '500 ms', `${limits.frameTimeoutMs} ms`],
    ['Maximum node ID', '15', String(limits.maxNodeId)],
  ];

  return (
    <div className="space-y-6">
      <div className="bg-[var(--t-surface)] border border-[var(--t-border)] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <ScrollingTitle as="h1" className="text-lg font-semibold text-[var(--t-ink)]">
            CsvProtocol.h Architecture &amp; FreeRTOS Reference
          </ScrollingTitle>
          <p className="text-sm text-[var(--t-ink-muted)] mt-0.5">
            ESP32 · Arduino framework · FreeRTOS · C++ · Decoupled fixed header and variable sensor fields
          </p>
        </div>
        <button
          onClick={onJumpToSimulator}
          className="glow-send-btn inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[var(--t-accent)] hover:bg-[var(--t-accent-hover)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Open 4-Window Transfer Bus
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 01. Fixed Header & Variable Payload */}
        <section className="glow-interpret-col bg-[var(--t-surface)] border-[6px] border-dotted border-[#1D4ED8] rounded-xl p-5 space-y-4">
          <div className="min-w-0">
            <ScrollingTitle as="h2" className="text-sm font-semibold text-[var(--t-ink)]">
              01. Fixed Header &amp; Variable Payload Separation
            </ScrollingTitle>
            <p className="text-xs text-[var(--t-ink-muted)] mt-0.5">
              Adding new sensors or namespaced IDs never changes the communication header.
            </p>
          </div>

          <div className="glow-interpret-col border border-[var(--t-cobalt-border)] rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[var(--t-surface-alt)] border-b border-[var(--t-border)] text-[var(--t-ink-muted)]">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Header Field</th>
                  <th className="text-left font-medium px-3 py-2">Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--t-border-soft)]">
                {headerFields.map(([field, purpose]) => (
                  <tr key={field} className="hover:bg-[var(--t-surface-alt)]/70">
                    <td className="px-3 py-2 font-mono font-semibold text-[var(--t-ink)]">{field}</td>
                    <td className="px-3 py-2 text-[var(--t-ink-muted)]">{purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 text-xs">
            <div className="font-medium text-[var(--t-ink)]">Wire Evolution Without Protocol Changes</div>
            <div className="bg-[var(--t-code-bg)] border border-[var(--t-border)] text-[var(--t-ink)] rounded-lg p-3 font-mono text-[11px] break-all space-y-2">
              <div>
                <div className="text-[var(--t-ink-soft)] mb-0.5">Original (3 fields):</div>
                <div>&lt;1,2,0,S,100,1732183000,3,3,CO2=480,HUM=65.5,TEMP=24.2*CRC&gt;</div>
              </div>
              <div>
                <div className="text-[var(--t-ink-soft)] mb-0.5">Extended (7 fields, same header):</div>
                <div>
                  &lt;1,2,0,S,101,1732183005,3,7,CO2=480,HUM=65.5,TEMP=24.2,PRESS=1013.2,S7.CO2=510,S7.TS=1732183004,DOOR=1*CRC&gt;
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 02. Library Capabilities Matrix */}
        <section className="bg-[var(--t-surface)] border-[6px] border-dotted border-[#047857] rounded-xl p-5 space-y-4">
          <div className="min-w-0">
            <ScrollingTitle as="h2" className="text-sm font-semibold text-[var(--t-ink)]">
              02. Protocol Feature &amp; Resilience Matrix
            </ScrollingTitle>
            <p className="text-xs text-[var(--t-ink-muted)] mt-0.5">
              All framing, integrity, replay, and routing mechanisms implemented in CsvProtocol.h.
            </p>
          </div>

          <div className="border border-[var(--t-border)] rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[var(--t-surface-alt)] border-b border-[var(--t-border)] text-[var(--t-ink-muted)]">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Feature</th>
                  <th className="text-left font-medium px-3 py-2">Implementation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--t-border-soft)]">
                {capabilities.map(([feat, impl]) => (
                  <tr key={feat} className="hover:bg-[var(--t-surface-alt)]/70">
                    <td className="px-3 py-2 font-medium text-[var(--t-ink)] whitespace-nowrap">{feat}</td>
                    <td className="px-3 py-2 text-[var(--t-ink-muted)]">{impl}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 03. FreeRTOS Task Ownership & Three-ESP32 Dual-UART */}
        <section className="bg-[var(--t-surface)] border-[6px] border-dotted border-[#D97706] rounded-xl p-5 space-y-4">
          <div className="min-w-0">
            <ScrollingTitle as="h2" className="text-sm font-semibold text-[var(--t-ink)]">
              03. FreeRTOS Task Pipeline &amp; Three-ESP32 Routing
            </ScrollingTitle>
            <p className="text-xs text-[var(--t-ink-muted)] mt-0.5">
              One RX task and one TX task own each physical UART; multiple app tasks safely enqueue frames.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {[
              ['UART RX Task', 'pollReceive() · CRC-16 check · 32-packet replay filter', 'glow-rx-col bg-[var(--t-emerald-soft)] border-[var(--t-emerald-border)] text-[var(--t-emerald)]'],
              ['Application Queue', 'Validated SafeCsvPacket structs delivered to logic', 'glow-interpret-col bg-[var(--t-cobalt-soft)] border-[var(--t-cobalt-border)] text-[var(--t-cobalt)]'],
              ['State Machine', 'DWIN display · relay control · sensor aggregation', 'glow-interpret-col bg-[var(--t-surface-alt)] border-[var(--t-border)] text-[var(--t-accent)]'],
              ['UART TX Task', 'processTx() · drains FreeRTOS FIFO TX queue', 'glow-tx-col bg-[var(--t-teal-soft)] border-[var(--t-accent-border)] text-[var(--t-teal)]'],
            ].map(([stage, desc, cls]) => (
              <div key={stage} className={`p-3 border rounded-lg ${cls}`}>
                <div className="font-semibold">{stage}</div>
                <div className="text-[var(--t-ink)] mt-1">{desc}</div>
              </div>
            ))}
          </div>

          <div className="glow-tx-col p-3.5 bg-[var(--t-code-bg)] border border-[var(--t-accent-border)] rounded-lg text-xs space-y-1.5 text-[var(--t-ink-muted)]">
            <div className="font-semibold text-[var(--t-ink)]">Multi-UART Broadcasting &amp; Relay Rules</div>
            <p>
              <span className="font-mono font-semibold text-[var(--t-cobalt)]">queueSendStamped()</span> stamps the packet once with the node&rsquo;s sequence number and session ID.
            </p>
            <p>
              <span className="font-mono font-semibold text-[var(--t-emerald)]">queueReplicate()</span> sends the exact stamped copy over the second UART (<span className="font-mono">Serial2</span>) with identical SEQ.
            </p>
            <p>
              <span className="font-mono font-semibold text-[var(--t-teal)]">queueForward()</span> relays a received packet while preserving original SRC, SEQ, and SID and decrementing TTL.
            </p>
          </div>
        </section>

        {/* 04. Compile-Time Limits Table */}
        <section className="bg-[var(--t-surface)] border-[6px] border-dotted border-[#E11D48] rounded-xl p-5 space-y-4">
          <div className="min-w-0">
            <ScrollingTitle as="h2" className="text-sm font-semibold text-[var(--t-ink)]">
              04. Compile-Time Configuration Limits
            </ScrollingTitle>
            <p className="text-xs text-[var(--t-ink-muted)] mt-0.5">
              Keep compatible limits across all communicating ESP32 boards when scaling your system.
            </p>
          </div>

          <div className="border border-[var(--t-border)] rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[var(--t-surface-alt)] border-b border-[var(--t-border)] text-[var(--t-ink-muted)]">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Setting</th>
                  <th className="text-right font-medium px-3 py-2">Default</th>
                  <th className="text-right font-medium px-3 py-2">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--t-border-soft)]">
                {defaultRows.map(([setting, def, active]) => (
                  <tr key={setting} className="hover:bg-[var(--t-surface-alt)]/70">
                    <td className="px-3 py-2 font-medium text-[var(--t-ink)]">{setting}</td>
                    <td className="px-3 py-2 text-right font-mono text-[var(--t-ink-soft)] tabular-nums">{def}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-[var(--t-accent)] tabular-nums">
                      {active}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
