import React, { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { ScrollingTitle } from './ScrollingTitle';
import { generateCsvProtocolHeader, generateThreeEsp32Example } from '../protocol/cppGenerator';
import { ProtocolLimits } from '../protocol/safeCsvEngine';

interface HeaderGeneratorViewProps {
  limits: ProtocolLimits;
  onDownloadHeader: () => void;
}

export const HeaderGeneratorView: React.FC<HeaderGeneratorViewProps> = ({
  limits,
  onDownloadHeader,
}) => {
  const [activeTab, setActiveTab] = useState<'header' | 'example'>('header');
  const [copied, setCopied] = useState(false);
  const [glowPhase, setGlowPhase] = useState<'a' | 'b' | null>('a');
  const nonceRef = React.useRef(1);
  const timerRef = React.useRef<number | null>(null);

  const triggerCodeGlow = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    nonceRef.current += 1;
    setGlowPhase(nonceRef.current % 2 === 0 ? 'a' : 'b');
    timerRef.current = window.setTimeout(() => {
      setGlowPhase(null);
      timerRef.current = null;
    }, 2150);
  };

  React.useEffect(() => {
    timerRef.current = window.setTimeout(() => {
      setGlowPhase(null);
      timerRef.current = null;
    }, 2150);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const headerCode = useMemo(() => generateCsvProtocolHeader(limits), [limits]);
  const exampleCode = useMemo(() => generateThreeEsp32Example(), []);

  const displayedCode = activeTab === 'header' ? headerCode : exampleCode;

  const handleCopy = () => {
    navigator.clipboard?.writeText(displayedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="space-y-5">
      <div className="bg-[var(--t-surface)] border border-[var(--t-border)] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <ScrollingTitle as="h1" className="text-lg font-semibold text-[var(--t-ink)]">
            Generated C++11 / FreeRTOS Library
          </ScrollingTitle>
          <p className="text-sm text-[var(--t-ink-muted)] mt-0.5">
            Single reusable header tailored to your active limits: {limits.maxFields} fields · {limits.maxKeyLen}/{limits.maxValLen} key/val · {limits.maxFrameLen} B buffer · {limits.frameTimeoutMs} ms timeout
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 p-1 bg-[var(--t-surface-alt)] border border-[var(--t-border-soft)] rounded-lg">
            <button
              onClick={() => {
                setActiveTab('header');
                triggerCodeGlow();
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'header'
                  ? 'bg-[var(--t-surface)] text-[var(--t-ink)] shadow-xs'
                  : 'text-[var(--t-ink-muted)] hover:text-[var(--t-ink)]'
              }`}
            >
              CsvProtocol.h
            </button>
            <button
              onClick={() => {
                setActiveTab('example');
                triggerCodeGlow();
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'example'
                  ? 'bg-[var(--t-surface)] text-[var(--t-ink)] shadow-xs'
                  : 'text-[var(--t-ink-muted)] hover:text-[var(--t-ink)]'
              }`}
            >
              3-ESP32 FreeRTOS Sketch
            </button>
          </div>

          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[var(--t-ink)] bg-[var(--t-surface)] border border-[var(--t-border)] rounded-lg hover:bg-[var(--t-surface-alt)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy Code'}
          </button>

          <button
            onClick={onDownloadHeader}
            className="glow-send-btn inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[var(--t-accent)] hover:bg-[var(--t-accent-hover)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Download CsvProtocol.h
          </button>
        </div>
      </div>

      <div
        className={`bg-[var(--t-code-bg)] border-[6px] border-dotted border-[#0F766E] rounded-xl overflow-hidden ${
          glowPhase ? `glow-interpret-col-${glowPhase}` : ''
        }`}
      >
        <div className="px-4 py-2.5 bg-[var(--t-teal-soft)] border-b border-[var(--t-teal-border)] flex items-center justify-between text-xs text-[var(--t-teal)] font-mono">
          <span>{activeTab === 'header' ? 'include/CsvProtocol.h' : 'src/PrimaryEsp32.cpp'}</span>
          <span className="tabular-nums">{displayedCode.split('\n').length} lines</span>
        </div>
        <pre className="p-4 text-xs font-mono text-[var(--t-ink)] overflow-x-auto max-h-[680px] leading-relaxed">
          <code>{displayedCode}</code>
        </pre>
      </div>
    </div>
  );
};
