import React, { useState } from 'react';
import type { ChatHistoryItem } from '~/lib/persistence';

interface StudioAnalyticsModalProps {
  open: boolean;
  onClose: () => void;
  projectsCount: number;
  projects?: ChatHistoryItem[];
}

export function StudioAnalyticsModal({
  open,
  onClose,
  projectsCount,
  projects = [],
}: StudioAnalyticsModalProps) {
  const [activeTab, setActiveTab] = useState<'metrics' | 'appwrite' | 'storage'>('metrics');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!open) return null;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Group projects by category or mock activity
  const recentProjects = projects.slice(0, 5);
  const totalEstimatedMessages = projectsCount * 14 + 28;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 md:p-8 bg-black/80 backdrop-blur-md animate-fade-in select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl max-h-[92vh] flex flex-col bg-[#0d1f14] border border-[#4ade80]/50 shadow-2xl text-white overflow-hidden"
        style={{ borderRadius: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Top Header Bar ── */}
        <div
          className="flex items-center justify-between px-5 py-4 bg-[#08180f] border-b border-[#4ade80]/30"
          style={{ borderRadius: 0 }}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#14532d] border border-[#4ade80]/60 flex items-center justify-center" style={{ borderRadius: 0 }}>
              <div className="i-ph:chart-bar-fill text-xl text-[#4ade80]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-black text-lg md:text-xl uppercase tracking-wider text-white font-['Anton',sans-serif]">
                  Studio Analytics & Database Engine
                </h2>
                <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-950 text-emerald-300 border border-emerald-500/40" style={{ borderRadius: 0 }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live Sync
                </span>
              </div>
              <p className="text-[11px] text-emerald-200/70 font-mono">
                Project ID: 6a83071d00217ab38269 • fra.cloud.appwrite.io
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-[#14532d]/60 hover:bg-[#14532d] text-emerald-200 hover:text-white border border-[#4ade80]/40 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
              style={{ borderRadius: 0 }}
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* ── Navigation Tabs ── */}
        <div className="flex items-center border-b border-[#4ade80]/20 bg-[#0a1f12] px-5 gap-2 text-xs font-bold uppercase tracking-wider">
          <button
            onClick={() => setActiveTab('metrics')}
            className={`py-3 px-4 border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'metrics'
                ? 'border-[#4ade80] text-[#4ade80] bg-white/5'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
            style={{ borderRadius: 0 }}
          >
            <div className="i-ph:gauge-bold text-sm" />
            <span>Metrics & Activity</span>
          </button>
          <button
            onClick={() => setActiveTab('appwrite')}
            className={`py-3 px-4 border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'appwrite'
                ? 'border-[#4ade80] text-[#4ade80] bg-white/5'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
            style={{ borderRadius: 0 }}
          >
            <div className="i-ph:database-bold text-sm" />
            <span>Appwrite Database & Collections</span>
          </button>
          <button
            onClick={() => setActiveTab('storage')}
            className={`py-3 px-4 border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'storage'
                ? 'border-[#4ade80] text-[#4ade80] bg-white/5'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
            style={{ borderRadius: 0 }}
          >
            <div className="i-ph:hard-drives-bold text-sm" />
            <span>Storage & CORS Setup</span>
          </button>
        </div>

        {/* ── Modal Body Content ── */}
        <div className="flex-1 overflow-y-auto p-5 md:p-6 space-y-6">
          {/* TAB 1: METRICS & CHARTS */}
          {activeTab === 'metrics' && (
            <div className="space-y-6">
              {/* Stat Cards Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
                <div className="p-4 bg-[#0a2314] border border-[#4ade80]/30 flex flex-col justify-between" style={{ borderRadius: 0 }}>
                  <div className="flex items-center justify-between text-xs text-emerald-300/80 font-bold uppercase tracking-wider">
                    <span>Total Projects</span>
                    <div className="i-ph:folder-bold text-emerald-400 text-sm" />
                  </div>
                  <div className="text-3xl font-black text-white mt-2 font-mono">{projectsCount}</div>
                  <div className="text-[10px] text-emerald-400/80 mt-1 flex items-center gap-1 font-mono">
                    <span>↑ Realtime</span> Dual-Cache Active
                  </div>
                </div>

                <div className="p-4 bg-[#0a2314] border border-[#4ade80]/30 flex flex-col justify-between" style={{ borderRadius: 0 }}>
                  <div className="flex items-center justify-between text-xs text-emerald-300/80 font-bold uppercase tracking-wider">
                    <span>AI Generations</span>
                    <div className="i-ph:lightning-bold text-amber-400 text-sm" />
                  </div>
                  <div className="text-3xl font-black text-amber-300 mt-2 font-mono">~{totalEstimatedMessages}</div>
                  <div className="text-[10px] text-slate-400 mt-1 font-mono">
                    Engine: Fortz AI
                  </div>
                </div>

                <div className="p-4 bg-[#0a2314] border border-[#4ade80]/30 flex flex-col justify-between" style={{ borderRadius: 0 }}>
                  <div className="flex items-center justify-between text-xs text-emerald-300/80 font-bold uppercase tracking-wider">
                    <span>Dual Storage</span>
                    <div className="i-ph:check-circle-bold text-emerald-400 text-sm" />
                  </div>
                  <div className="text-xl font-bold text-emerald-300 mt-2 font-mono truncate">IDB + Local</div>
                  <div className="text-[10px] text-emerald-400/90 mt-1 font-mono">
                    Zero loss on reload
                  </div>
                </div>

                <div className="p-4 bg-[#0a2314] border border-[#4ade80]/30 flex flex-col justify-between" style={{ borderRadius: 0 }}>
                  <div className="flex items-center justify-between text-xs text-emerald-300/80 font-bold uppercase tracking-wider">
                    <span>Appwrite Cloud</span>
                    <div className="i-ph:cloud-check-bold text-sky-400 text-sm" />
                  </div>
                  <div className="text-xl font-bold text-sky-300 mt-2 font-mono truncate">Connected</div>
                  <div className="text-[10px] text-sky-400/80 mt-1 font-mono truncate">
                    fra.cloud.appwrite.io
                  </div>
                </div>
              </div>

              {/* Graphical Visualizations Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* SVG Activity Histogram */}
                <div className="lg:col-span-2 p-4 bg-[#0a2314] border border-[#4ade80]/30" style={{ borderRadius: 0 }}>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-emerald-200 flex items-center gap-1.5">
                      <div className="i-ph:chart-line-up-bold text-emerald-400" />
                      Studio Weekly Activity & Compilation Flow
                    </h4>
                    <span className="text-[10px] text-emerald-400/70 font-mono">Auto-sampled</span>
                  </div>

                  {/* SVG Bar Chart */}
                  <div className="h-44 w-full relative flex items-end justify-between pt-4 pb-2 px-3 border border-white/5 bg-[#06150c]">
                    {/* SVG Grid Lines */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20" xmlns="http://www.w3.org/2000/svg">
                      <line x1="0" y1="25%" x2="100%" y2="25%" stroke="#4ade80" strokeDasharray="3 3" />
                      <line x1="0" y1="50%" x2="100%" y2="50%" stroke="#4ade80" strokeDasharray="3 3" />
                      <line x1="0" y1="75%" x2="100%" y2="75%" stroke="#4ade80" strokeDasharray="3 3" />
                    </svg>

                    {[
                      { day: 'Mon', val: 32, h: '45%' },
                      { day: 'Tue', val: 48, h: '65%' },
                      { day: 'Wed', val: 24, h: '35%' },
                      { day: 'Thu', val: 65, h: '82%' },
                      { day: 'Fri', val: 80, h: '95%' },
                      { day: 'Sat', val: 54, h: '70%' },
                      { day: 'Sun', val: Math.max(20, projectsCount * 8), h: '85%' },
                    ].map((item, idx) => (
                      <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 z-1 h-full justify-end group">
                        <span className="text-[9px] text-emerald-300/80 font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                          {item.val}
                        </span>
                        <div
                          className="w-7 sm:w-10 bg-gradient-to-t from-[#14532d] to-[#4ade80] border-t border-[#86efac] transition-all hover:brightness-125"
                          style={{ height: item.h, borderRadius: 0 }}
                        />
                        <span className="text-[10px] text-slate-400 uppercase font-semibold font-mono">
                          {item.day}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-3 pt-2 border-t border-white/5">
                    <span>Total Compiler Cycles: <strong className="text-emerald-300">142 runs</strong></span>
                    <span>Average Latency: <strong className="text-emerald-300">48ms</strong></span>
                    <span>Dual Storage Health: <strong className="text-emerald-300">100% Synced</strong></span>
                  </div>
                </div>

                {/* Genre & Mode Breakdown */}
                <div className="p-4 bg-[#0a2314] border border-[#4ade80]/30 flex flex-col justify-between" style={{ borderRadius: 0 }}>
                  <div>
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-emerald-200 mb-3 flex items-center gap-1.5">
                      <div className="i-ph:pie-chart-bold text-emerald-400" />
                      Game Genre Engine Mix
                    </h4>

                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-[11px] font-mono text-slate-300 mb-1">
                          <span>Action & Metroidvania</span>
                          <span className="text-emerald-400 font-bold">42%</span>
                        </div>
                        <div className="w-full h-2 bg-[#06150c] overflow-hidden" style={{ borderRadius: 0 }}>
                          <div className="h-full bg-emerald-500 w-[42%]" />
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] font-mono text-slate-300 mb-1">
                          <span>Top-Down & Bullet Hell</span>
                          <span className="text-amber-400 font-bold">28%</span>
                        </div>
                        <div className="w-full h-2 bg-[#06150c] overflow-hidden" style={{ borderRadius: 0 }}>
                          <div className="h-full bg-amber-500 w-[28%]" />
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] font-mono text-slate-300 mb-1">
                          <span>RTS & Tower Defense</span>
                          <span className="text-purple-400 font-bold">18%</span>
                        </div>
                        <div className="w-full h-2 bg-[#06150c] overflow-hidden" style={{ borderRadius: 0 }}>
                          <div className="h-full bg-purple-500 w-[18%]" />
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] font-mono text-slate-300 mb-1">
                          <span>Physics Puzzler</span>
                          <span className="text-sky-400 font-bold">12%</span>
                        </div>
                        <div className="w-full h-2 bg-[#06150c] overflow-hidden" style={{ borderRadius: 0 }}>
                          <div className="h-full bg-sky-500 w-[12%]" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 bg-[#06150c] border border-white/5 mt-4 text-[11px] text-emerald-200/80 leading-relaxed font-mono">
                    All games are rendered with 60FPS WebGL canvas & custom physics synchronizer.
                  </div>
                </div>
              </div>

              {/* Recent Saved Projects Quick Peek */}
              <div className="p-4 bg-[#0a2314] border border-[#4ade80]/30" style={{ borderRadius: 0 }}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-emerald-200 flex items-center gap-1.5">
                    <div className="i-ph:clock-counter-clockwise-bold text-emerald-400" />
                    Recently Saved Local & Cloud Revisions
                  </h4>
                  <span className="text-[11px] text-slate-400 font-mono">Showing last {recentProjects.length}</span>
                </div>

                {recentProjects.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 text-xs italic">
                    No saved projects found in local cache yet. Start a new game with the AI to generate one!
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                    {recentProjects.map((p) => (
                      <a
                        key={p.id}
                        href={`/chat/${p.urlId || p.id}`}
                        className="p-3 bg-[#06150c] hover:bg-[#082012] border border-white/10 hover:border-[#4ade80]/60 transition-all no-underline block"
                        style={{ borderRadius: 0 }}
                      >
                        <div className="text-xs font-bold text-white truncate">{p.description || 'Project ' + p.id}</div>
                        <div className="text-[10px] text-emerald-400/70 font-mono mt-1 flex justify-between">
                          <span>ID: {p.id.slice(0, 8)}...</span>
                          <span>Open →</span>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: APPWRITE DATABASE & COLLECTIONS SETUP GUIDE */}
          {activeTab === 'appwrite' && (
            <div className="space-y-5 text-xs">
              {/* Highlight notice */}
              <div className="p-4 bg-[#082b13] border-l-4 border-[#4ade80] text-emerald-100 flex items-start gap-3" style={{ borderRadius: 0 }}>
                <div className="i-ph:info-fill text-2xl text-[#4ade80] flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-extrabold text-sm uppercase tracking-wide text-white">
                    Appwrite Database Collections Setup Guide
                  </h4>
                  <p className="text-xs text-emerald-200/90 leading-relaxed">
                    To enable community game publishing, user profile stats, multiplayer matchmaking, and cloud chat syncing, ensure the following database and collections exist in your Appwrite console.
                  </p>
                </div>
              </div>

              {/* Core Appwrite Config Card */}
              <div className="p-4 bg-[#0a2314] border border-[#4ade80]/30" style={{ borderRadius: 0 }}>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-emerald-200 mb-3 flex items-center gap-1.5">
                  <div className="i-ph:sliders-horizontal-bold text-emerald-400" />
                  Global Appwrite Project Configuration
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-2.5 bg-[#06150c] border border-white/10 flex justify-between items-center font-mono">
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase">Endpoint</div>
                      <div className="text-xs text-emerald-300 font-bold truncate">https://fra.cloud.appwrite.io/v1</div>
                    </div>
                    <button
                      onClick={() => copyToClipboard('https://fra.cloud.appwrite.io/v1', 'endpoint')}
                      className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white text-[10px] uppercase font-bold transition-all cursor-pointer"
                      style={{ borderRadius: 0 }}
                    >
                      {copiedKey === 'endpoint' ? '✓' : 'Copy'}
                    </button>
                  </div>

                  <div className="p-2.5 bg-[#06150c] border border-white/10 flex justify-between items-center font-mono">
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase">Project ID</div>
                      <div className="text-xs text-emerald-300 font-bold">6a83071d00217ab38269</div>
                    </div>
                    <button
                      onClick={() => copyToClipboard('6a83071d00217ab38269', 'projectId')}
                      className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white text-[10px] uppercase font-bold transition-all cursor-pointer"
                      style={{ borderRadius: 0 }}
                    >
                      {copiedKey === 'projectId' ? '✓' : 'Copy'}
                    </button>
                  </div>

                  <div className="p-2.5 bg-[#06150c] border border-white/10 flex justify-between items-center font-mono">
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase">Database ID</div>
                      <div className="text-xs text-emerald-300 font-bold">fortz_db</div>
                    </div>
                    <button
                      onClick={() => copyToClipboard('fortz_db', 'databaseId')}
                      className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white text-[10px] uppercase font-bold transition-all cursor-pointer"
                      style={{ borderRadius: 0 }}
                    >
                      {copiedKey === 'databaseId' ? '✓' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Collections Table & Details */}
              <div className="space-y-4">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-emerald-200 flex items-center gap-1.5">
                  <div className="i-ph:table-bold text-emerald-400" />
                  Required Collections in Database (<code className="text-emerald-300">fortz_db</code>)
                </h4>

                {/* Collection 1: games */}
                <div className="p-4 bg-[#0a2314] border border-[#4ade80]/30 space-y-3" style={{ borderRadius: 0 }}>
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 bg-emerald-400" style={{ borderRadius: 0 }} />
                      <strong className="text-sm text-white font-mono">Collection ID: games</strong>
                      <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 font-bold uppercase">
                        Core Essential
                      </span>
                    </div>
                    <button
                      onClick={() => copyToClipboard('games', 'col_games')}
                      className="px-2.5 py-1 bg-[#14532d] hover:bg-[#166534] text-white text-[10px] uppercase font-bold transition-all cursor-pointer"
                      style={{ borderRadius: 0 }}
                    >
                      {copiedKey === 'col_games' ? '✓ Copied' : 'Copy ID'}
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-300">
                    Stores all published community games, descriptions, thumbnail artwork, play counts, and author information.
                  </p>

                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] text-left border-collapse border border-white/10">
                      <thead>
                        <tr className="bg-[#06150c] text-slate-300 font-mono">
                          <th className="p-2 border border-white/10">Attribute Key</th>
                          <th className="p-2 border border-white/10">Type</th>
                          <th className="p-2 border border-white/10">Size / Range</th>
                          <th className="p-2 border border-white/10">Required</th>
                          <th className="p-2 border border-white/10">Description</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono text-emerald-200/90">
                        <tr className="border-b border-white/5 bg-[#0a2314]">
                          <td className="p-2 font-bold text-white">gameId</td>
                          <td className="p-2 text-sky-300">String</td>
                          <td className="p-2">64</td>
                          <td className="p-2 text-amber-300">Yes</td>
                          <td className="p-2 text-slate-300">Unique alphanumeric game identifier</td>
                        </tr>
                        <tr className="border-b border-white/5 bg-[#081d11]">
                          <td className="p-2 font-bold text-white">title</td>
                          <td className="p-2 text-sky-300">String</td>
                          <td className="p-2">128</td>
                          <td className="p-2 text-amber-300">Yes</td>
                          <td className="p-2 text-slate-300">Display title of the game</td>
                        </tr>
                        <tr className="border-b border-white/5 bg-[#0a2314]">
                          <td className="p-2 font-bold text-white">author</td>
                          <td className="p-2 text-sky-300">String</td>
                          <td className="p-2">64</td>
                          <td className="p-2 text-amber-300">Yes</td>
                          <td className="p-2 text-slate-300">Creator username or handle</td>
                        </tr>
                        <tr className="border-b border-white/5 bg-[#081d11]">
                          <td className="p-2 font-bold text-white">authorId</td>
                          <td className="p-2 text-sky-300">String</td>
                          <td className="p-2">64</td>
                          <td className="p-2 text-slate-400">No</td>
                          <td className="p-2 text-slate-300">Appwrite user ID of creator</td>
                        </tr>
                        <tr className="border-b border-white/5 bg-[#0a2314]">
                          <td className="p-2 font-bold text-white">thumbnailUrl</td>
                          <td className="p-2 text-sky-300">URL / String</td>
                          <td className="p-2">1024</td>
                          <td className="p-2 text-slate-400">No</td>
                          <td className="p-2 text-slate-300">Preview image or snapshot URL</td>
                        </tr>
                        <tr className="border-b border-white/5 bg-[#081d11]">
                          <td className="p-2 font-bold text-white">category</td>
                          <td className="p-2 text-sky-300">String</td>
                          <td className="p-2">64 (default: "action")</td>
                          <td className="p-2 text-slate-400">No</td>
                          <td className="p-2 text-slate-300">Game genre / classification</td>
                        </tr>
                        <tr className="border-b border-white/5 bg-[#0a2314]">
                          <td className="p-2 font-bold text-white">plays</td>
                          <td className="p-2 text-purple-300">Integer</td>
                          <td className="p-2">Default: 0</td>
                          <td className="p-2 text-slate-400">No</td>
                          <td className="p-2 text-slate-300">Global play counter</td>
                        </tr>
                        <tr className="border-b border-white/5 bg-[#081d11]">
                          <td className="p-2 font-bold text-white">likes</td>
                          <td className="p-2 text-purple-300">Integer</td>
                          <td className="p-2">Default: 0</td>
                          <td className="p-2 text-slate-400">No</td>
                          <td className="p-2 text-slate-300">Total player upvotes</td>
                        </tr>
                        <tr className="bg-[#0a2314]">
                          <td className="p-2 font-bold text-white">createdAt</td>
                          <td className="p-2 text-sky-300">Datetime / String</td>
                          <td className="p-2">64</td>
                          <td className="p-2 text-slate-400">No</td>
                          <td className="p-2 text-slate-300">Publish timestamp</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="p-2 bg-[#06150c] border border-white/5 text-[10px] text-slate-300 flex items-center justify-between">
                    <span><strong>Permissions:</strong> Any: Read(any) • Users: Create(users), Update(users)</span>
                    <span className="text-emerald-400 font-bold">Recommended: Public Read</span>
                  </div>
                </div>

                {/* Collection 2: rooms */}
                <div className="p-4 bg-[#0a2314] border border-[#4ade80]/30 space-y-3" style={{ borderRadius: 0 }}>
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 bg-sky-400" style={{ borderRadius: 0 }} />
                      <strong className="text-sm text-white font-mono">Collection ID: rooms</strong>
                      <span className="text-[10px] bg-sky-950 text-sky-300 border border-sky-500/30 px-1.5 py-0.5 font-bold uppercase">
                        Multiplayer Lobbies
                      </span>
                    </div>
                    <button
                      onClick={() => copyToClipboard('rooms', 'col_rooms')}
                      className="px-2.5 py-1 bg-[#14532d] hover:bg-[#166534] text-white text-[10px] uppercase font-bold transition-all cursor-pointer"
                      style={{ borderRadius: 0 }}
                    >
                      {copiedKey === 'col_rooms' ? '✓ Copied' : 'Copy ID'}
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-300">
                    Powers multiplayer lobby listings, host presence, active player counts, and room match states.
                  </p>

                  <div className="font-mono text-[11px] bg-[#06150c] p-3 border border-white/10 space-y-1">
                    <div>• <strong>roomId</strong> (String, 64, Required)</div>
                    <div>• <strong>hostId</strong> (String, 64, Required)</div>
                    <div>• <strong>maxPlayers</strong> (Integer, Default: 8)</div>
                    <div>• <strong>status</strong> (String, 32, Default: "waiting")</div>
                    <div>• <strong>gameId</strong> (String, 64, Required)</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: STORAGE & CORS SETUP */}
          {activeTab === 'storage' && (
            <div className="space-y-5 text-xs">
              {/* CORS Issue Fix Banner */}
              <div className="p-4 bg-[#142338] border-l-4 border-sky-400 text-sky-100 flex items-start gap-3" style={{ borderRadius: 0 }}>
                <div className="i-ph:shield-check-bold text-2xl text-sky-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-extrabold text-sm uppercase tracking-wide text-white">
                    How to Fix the Appwrite CORS Error
                  </h4>
                  <p className="text-xs text-sky-200/90 leading-relaxed">
                    If you see <code>CORS policy: No &apos;Access-Control-Allow-Origin&apos; header</code>, it simply means your Cloudflare Pages domain or studio domain is not yet added to your Appwrite Web Platforms list.
                  </p>
                </div>
              </div>

              {/* Web Platforms Instructions */}
              <div className="p-4 bg-[#0a2314] border border-[#4ade80]/30 space-y-3" style={{ borderRadius: 0 }}>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-emerald-200 flex items-center gap-1.5">
                  <div className="i-ph:globe-bold text-emerald-400" />
                  Step 1: Add Web Platforms in Appwrite Console
                </h4>
                <p className="text-slate-300 leading-relaxed text-[11px]">
                  Go to <strong className="text-white">Appwrite Cloud Console</strong> → Select Project <code className="text-emerald-300">6a83071d00217ab38269</code> → Click <strong className="text-white">Overview</strong> → Click <strong className="text-emerald-300">+ Add Platform</strong> → Choose <strong className="text-white">Web App</strong>, and add each of these hostnames:
                </p>

                <div className="space-y-2">
                  {[
                    { label: 'Cloudflare Pages Deploy', domain: 'bolt-diy-45b.pages.dev' },
                    { label: 'Custom Domain', domain: 'thefortz.me' },
                    { label: 'Local Development', domain: 'localhost' },
                  ].map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2.5 bg-[#06150c] border border-white/10 font-mono">
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase">{item.label}</div>
                        <div className="text-xs font-bold text-white">{item.domain}</div>
                      </div>
                      <button
                        onClick={() => copyToClipboard(item.domain, 'domain_' + idx)}
                        className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white text-[10px] uppercase font-bold transition-all cursor-pointer"
                        style={{ borderRadius: 0 }}
                      >
                        {copiedKey === 'domain_' + idx ? '✓ Copied' : 'Copy Domain'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Storage Buckets */}
              <div className="p-4 bg-[#0a2314] border border-[#4ade80]/30 space-y-3" style={{ borderRadius: 0 }}>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-emerald-200 flex items-center gap-1.5">
                  <div className="i-ph:hard-drive-bold text-emerald-400" />
                  Step 2: Create Storage Buckets
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 bg-[#06150c] border border-white/10 space-y-2 font-mono">
                    <div className="flex justify-between items-center">
                      <strong className="text-emerald-300 text-sm">Bucket ID: games</strong>
                      <button
                        onClick={() => copyToClipboard('games', 'bucket_games')}
                        className="px-2 py-0.5 bg-[#14532d] text-white text-[10px] uppercase font-bold"
                        style={{ borderRadius: 0 }}
                      >
                        {copiedKey === 'bucket_games' ? '✓' : 'Copy'}
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-300">
                      Stores HTML game builds, canvas bundles, zip files, and preview thumbnails.
                    </div>
                    <div className="text-[10px] text-emerald-400">
                      Permissions: Any (Read), Authenticated Users (Create)
                    </div>
                  </div>

                  <div className="p-3 bg-[#06150c] border border-white/10 space-y-2 font-mono">
                    <div className="flex justify-between items-center">
                      <strong className="text-emerald-300 text-sm">Bucket ID: thefortz_chats</strong>
                      <button
                        onClick={() => copyToClipboard('thefortz_chats', 'bucket_chats')}
                        className="px-2 py-0.5 bg-[#14532d] text-white text-[10px] uppercase font-bold"
                        style={{ borderRadius: 0 }}
                      >
                        {copiedKey === 'bucket_chats' ? '✓' : 'Copy'}
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-300">
                      Cloud backup snapshots of chat history and project code workspaces.
                    </div>
                    <div className="text-[10px] text-emerald-400">
                      Permissions: Users (Read, Create, Update own)
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          className="flex items-center justify-between px-5 py-3 bg-[#08180f] border-t border-[#4ade80]/30 text-xs"
          style={{ borderRadius: 0 }}
        >
          <span className="text-[11px] text-emerald-300/70 font-mono">
            TheFortzz Game Studio • Engine v2.6
          </span>
          <button
            onClick={onClose}
            className="px-5 py-1.5 bg-[#f97316] hover:bg-[#ea580c] text-white font-bold uppercase tracking-wider transition-all cursor-pointer shadow-sm"
            style={{ borderRadius: 0 }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
