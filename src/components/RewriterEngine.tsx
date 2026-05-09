import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Zap, Mic, Scissors, RefreshCw, Download, Loader2 } from 'lucide-react';
import { rewriteTranscriptWithFramework } from '../services/gemini';

interface Props {
  initialTranscript: string;
  phases: any[];
  onBack: () => void;
}

export function RewriterEngine({ initialTranscript, phases, onBack }: Props) {
  const [transcript, setTranscript] = useState(initialTranscript);
  const [script, setScript] = useState('');
  const [status, setStatus] = useState<'idle' | 'rewriting' | 'generating_audio' | 'done'>('idle');
  const [progress, setProgress] = useState(0);

  // Sync if it changes
  useEffect(() => {
    if (initialTranscript) setTranscript(initialTranscript);
  }, [initialTranscript]);

  const handleRewrite = async () => {
    if (!transcript.trim() || !phases?.length) {
      window.alert("Please make sure you have a transcript and a framework (climax phases) from the analysis tab.");
      return;
    }
    setStatus('rewriting');
    setProgress(30);
    try {
      const rewritten = await rewriteTranscriptWithFramework(transcript, phases);
      setProgress(100);
      setScript(rewritten);
    } catch (e) {
      console.error(e);
      window.alert("Failed to rewrite transcript.");
    } finally {
      setStatus('idle');
      setProgress(0);
    }
  };

  const handleGenerateVoiceover = () => {
    setStatus('generating_audio');
    setProgress(0);
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(interval);
          setStatus('done');
          return 0;
        }
        return p + Math.random() * 15;
      });
    }, 400);
  };

  const getCleanCharCount = (text: string) => {
    // Remove lines that look like our generated segment headers (e.g. "1. 0-5s:")
    const cleaned = text.split('\n').filter(line => {
      return !/^\s*(?:\*\*)?\d+\.\s*[\d-]+/.test(line);
    }).join('\n');
    return cleaned.trim().length;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-[#FF0033]" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-[#FF0033]">
              AI Rewriter Engine
            </span>
          </div>
          <h1 className="text-4xl font-serif font-bold tracking-tight text-[#1A1A1A]">
            Auto-generate & Trim.
          </h1>
        </div>
        <button 
          onClick={onBack}
          className="px-6 py-2 rounded-xl text-xs font-mono font-bold uppercase tracking-widest border border-[#1A1A1A]/10 hover:border-[#FF0033] hover:text-[#FF0033] transition-all"
        >
          Back
        </button>
      </header>

      {/* Main Work Area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Source Text */}
        <div className="bg-white rounded-[2rem] p-6 border border-[#1A1A1A]/5 shadow-sm flex flex-col h-[600px]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Source Transcript</h3>
            <span className="text-xs font-mono font-bold text-[#1A1A1A]/40">{transcript.length} chars</span>
          </div>
          <textarea 
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            className="flex-1 w-full bg-[#F9F8F6] rounded-xl p-4 resize-none outline-none font-sans text-sm leading-relaxed text-[#1A1A1A]/80 border border-transparent focus:border-[#FF0033]/30 transition-colors"
            placeholder="Paste your source video transcript here..."
          />
          <button 
            onClick={handleRewrite}
            disabled={status !== 'idle' || !transcript.trim()}
            className="mt-6 w-full flex items-center justify-center gap-2 bg-[#FFDE32] text-[#1A1A1A] py-4 rounded-xl font-mono text-[11px] font-bold uppercase tracking-widest shadow-xl shadow-[#FFDE32]/25 hover:bg-[#FF0033] hover:text-white disabled:opacity-50 transition-all"
          >
            {status === 'rewriting' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {status === 'rewriting' ? 'Analyzing & Rewriting...' : 'Rewrite Script'}
          </button>
        </div>

        {/* Target Script & Voiceover */}
        <div className="bg-white rounded-[2rem] p-6 border border-[#1A1A1A]/5 shadow-sm flex flex-col h-[600px] relative overflow-hidden">
          {status === 'rewriting' && (
            <div className="absolute inset-0 z-10 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center">
               <div className="w-48 h-1 bg-[#1A1A1A]/10 rounded-full overflow-hidden mb-4">
                 <div className="h-full bg-[#FF0033]" style={{ width: `${Math.min(100, progress)}%` }} />
               </div>
               <p className="font-mono text-[10px] uppercase tracking-widest text-[#FF0033] animate-pulse">Generating New Script...</p>
            </div>
          )}

          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-[#FF0033]">Rewritten Segmented Script</h3>
            <div className="flex items-center gap-4">
              <span className="text-xs font-mono font-bold text-[#FF0033]/60">
                {getCleanCharCount(script)} chars
              </span>
              <span className="bg-[#FF0033]/10 text-[#FF0033] px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase tracking-widest">
                {phases?.length || 0} Segments
              </span>
            </div>
          </div>
          <textarea 
            value={script}
            onChange={(e) => setScript(e.target.value)}
            className="flex-1 w-full bg-[#F9F8F6] rounded-xl p-4 resize-none outline-none font-sans text-sm leading-relaxed text-[#1A1A1A] border border-transparent focus:border-[#FF0033]/30 transition-colors"
            placeholder="Your segmented rewrite will appear here..."
          />
          
          <div className="mt-6 grid grid-cols-2 gap-4">
            <button 
              onClick={handleGenerateVoiceover}
              disabled={status !== 'idle' || !script.trim()}
              className="flex items-center justify-center gap-2 bg-[#FFDE32] text-[#1A1A1A] py-4 rounded-xl font-mono text-[11px] font-bold uppercase tracking-widest shadow-xl shadow-[#FFDE32]/25 hover:bg-[#FF0033] hover:text-white disabled:opacity-50 transition-all"
            >
              {status === 'generating_audio' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
              Generate Voiceover
            </button>
            <button 
              disabled={true}
              className="flex items-center justify-center gap-2 border border-[#1A1A1A]/10 text-[#1A1A1A]/40 py-4 rounded-xl font-mono text-[11px] font-bold uppercase tracking-widest bg-[#F9F8F6]"
            >
              <Scissors className="w-4 h-4" />
              Trim Silence (Pro)
            </button>
          </div>

          {/* Audio Player placeholder (appears when done) */}
          {status === 'done' && (
             <motion.div 
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               className="absolute bottom-6 left-6 right-6 bg-[#1A1A1A] p-4 flex items-center justify-between rounded-xl shadow-2xl"
             >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white cursor-pointer hover:bg-white/20 transition-colors">
                    <Mic className="w-4 h-4" />
                  </div>
                  <div className="h-1 w-32 bg-white/20 rounded-full">
                    <div className="h-full bg-[#FF0033] w-1/3 rounded-full" />
                  </div>
                  <span className="font-mono text-[9px] text-white/50">0:14 / 1:04</span>
                </div>
                <button className="text-white hover:text-[#FF0033] transition-colors"><Download className="w-4 h-4" /></button>
             </motion.div>
          )}

        </div>
      </div>
    </div>
  );
}
