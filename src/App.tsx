/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { ArchitectureReference } from './components/ArchitectureReference';
import { FourWindowTransferLab } from './components/FourWindowTransferLab';
import { HeaderGeneratorView } from './components/HeaderGeneratorView';
import { ProtocolDesigner } from './components/ProtocolDesigner';
import { generateCsvProtocolHeader } from './protocol/cppGenerator';
import {
  DEFAULT_LIMITS,
  PACKET_PRESETS,
  ProtocolLimits,
  SafeCsvPacket,
} from './protocol/safeCsvEngine';

type ActiveSection = 'bus' | 'designer' | 'header' | 'architecture';

const STORAGE_LIMITS_KEY = 'safecsv_studio_limits_v1';
const STORAGE_PACKET_KEY = 'safecsv_studio_packet_v1';

export default function App() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('bus');

  const [limits, setLimits] = useState<ProtocolLimits>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_LIMITS_KEY);
      if (saved) return { ...DEFAULT_LIMITS, ...JSON.parse(saved) };
    } catch {
      // Fallback to defaults
    }
    return DEFAULT_LIMITS;
  });

  const [designedPacket, setDesignedPacket] = useState<SafeCsvPacket>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_PACKET_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // Fallback to extended 7-field preset
    }
    return PACKET_PRESETS[1].packet;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_LIMITS_KEY, JSON.stringify(limits));
    } catch {
      // Ignore storage quota errors
    }
  }, [limits]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PACKET_KEY, JSON.stringify(designedPacket));
    } catch {
      // Ignore storage quota errors
    }
  }, [designedPacket]);

  const handleDownloadHeader = () => {
    const content = generateCsvProtocolHeader(limits);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'CsvProtocol.h';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const navItems: { id: ActiveSection; label: string }[] = [
    { id: 'bus', label: '4-Window Bus' },
    { id: 'designer', label: 'Protocol Designer' },
    { id: 'header', label: 'CsvProtocol.h' },
    { id: 'architecture', label: 'Architecture' },
  ];

  return (
    <div className="min-h-screen bg-[var(--t-canvas)] text-[var(--t-ink)] flex flex-col">
      {/* Three-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-[var(--t-header)]/95 backdrop-blur border-b border-[var(--t-border)]">
        <div className="w-full mx-0 px-0 h-14 flex items-center justify-between gap-4 xl:gap-8 bg-[#5997b1]">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            onClick={() => setActiveSection('bus')}
            className="text-[32px] leading-none font-bold tracking-tight text-[#ffffff] whitespace-nowrap shrink-0 cursor-pointer"
          >
            CSV Design Studio
          </button>

          {/* Zone 2: 4 single-line text navigation links */}
          <nav className="flex items-center gap-2.5 overflow-x-auto py-1">
            {navItems.map((item, idx) => {
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`text-sm whitespace-nowrap shrink-0 px-3.5 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#FFF6E0] text-[#5C2D0C] font-bold border-[#FFE082] nav-tab-active-glow'
                      : idx === 0
                      ? 'text-[#fff4eb] font-medium border-transparent hover:bg-white/15 hover:border-white/30'
                      : 'text-[#ffffff] font-medium border-transparent hover:bg-white/15 hover:border-white/30'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="shrink-0 hidden sm:block">
            <button
              onClick={handleDownloadHeader}
              className="px-4 py-2 text-xs font-semibold text-[var(--t-accent-ink)] bg-[var(--t-accent-soft)] hover:bg-[var(--t-accent-soft-hover)] border border-[var(--t-accent-border)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Download CsvProtocol.h
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 w-full mx-0 px-0 py-6 bg-[#767676]">
        {activeSection === 'bus' && (
          <FourWindowTransferLab limits={limits} designedPacket={designedPacket} />
        )}
        {activeSection === 'designer' && (
          <ProtocolDesigner
            packet={designedPacket}
            onChangePacket={setDesignedPacket}
            limits={limits}
            onChangeLimits={setLimits}
            onTestInFourWindows={() => setActiveSection('bus')}
          />
        )}
        {activeSection === 'header' && (
          <HeaderGeneratorView
            limits={limits}
            onDownloadHeader={handleDownloadHeader}
          />
        )}
        {activeSection === 'architecture' && (
          <ArchitectureReference
            limits={limits}
            onJumpToSimulator={() => setActiveSection('bus')}
          />
        )}
      </main>
    </div>
  );
}
