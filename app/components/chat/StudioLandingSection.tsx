import React from 'react';

interface StudioLandingSectionProps {
  onSelectTemplate: (prompt: string) => void;
  onLaunchTemplate: (event: React.UIEvent, prompt: string) => void;
  onOpenSettings: () => void;
  fortzBalance?: number;
}

interface TemplateCard {
  id: string;
  title: string;
  genre: string;
  badge: string;
  badgeColor: string;
  icon: string;
  description: string;
  features: string[];
  prompt: string;
}

const TEMPLATES: TemplateCard[] = [
  {
    id: 'platformer',
    title: 'Cyberpunk 2D Platformer',
    genre: 'PLATFORMER',
    badge: 'POPULAR',
    badgeColor: '#06b6d4',
    icon: '🕹️',
    description: 'Smooth run & double-jump physics, moving platforms, collectible coins, hazard traps, and enemy stomping.',
    features: ['Double Jump & Wall Slide', 'Moving Obstacles & Traps', 'Web Audio Synth FX'],
    prompt:
      'Create a complete retro 2D platformer game in HTML5 canvas and modern JavaScript. Include player physics (smooth run acceleration, gravity, double jump, wall slide), 3 distinct platform types (solid, bouncy, moving), collectible gold coins, dangerous hazard spikes, stomping enemies with patrol AI, a live HUD with score, health, and lives, sound effects using Web Audio API synth, and level transition when reaching the golden flag.',
  },
  {
    id: 'space-shooter',
    title: 'Orbital Bullet Hell',
    genre: 'ACTION • ARCADE',
    badge: 'HIGH INTENSITY',
    badgeColor: '#8b5cf6',
    icon: '🚀',
    description: '360° mouse-aim spaceship combat, laser upgrades, procedural waves, intense screen shake, and boss fight.',
    features: ['Laser & Missile Upgrades', 'Procedural Wave AI', 'Screen Shake & Particles'],
    prompt:
      'Build a high-intensity retro top-down space bullet hell shooter in HTML5 canvas. Include 360-degree player movement with thruster particle trails, mouse aim shooting with multiple weapon upgrades (spread shot, laser beam, homing missiles), procedural wave spawning of alien ships, intense screen shake on explosions, glowing particle effects, sound synthesis, and an epic multi-phase boss fight with bullet patterns.',
  },
  {
    id: 'metroidvania',
    title: 'Dungeon Crawler RPG',
    genre: 'ADVENTURE • RPG',
    badge: 'DEEP GAMEPLAY',
    badgeColor: '#10b981',
    icon: '⚔️',
    description: 'Melee sword combo attacks, enemy AI pathfinding, keys & locked doors, chest loot, and boss chamber.',
    features: ['Melee Combos & Dash', 'Keys & Door Puzzles', 'Minimap & Boss AI'],
    prompt:
      'Create a rich 2D top-down dungeon crawler adventure RPG. Feature player combat (sword slash attack, dash dodge with invulnerability frames), health and mana HUD, multiple enemy types (slime, skeleton archer), inventory system with key pickups to unlock sealed doors, chest loot with weapon upgrades, minimap display, and an ominous dungeon boss.',
  },
  {
    id: 'physics-puzzle',
    title: 'Kinematic Physics Sandbox',
    genre: 'PUZZLE • PHYSICS',
    badge: 'BRAIN TEASER',
    badgeColor: '#f59e0b',
    icon: '🧩',
    description: 'Impulse forces, bouncy trampolines, gravity flip switches, laser obstacles, and progressive puzzle stages.',
    features: ['Rigid Body Collisions', 'Gravity Inversion Switch', '5 Star-Rated Levels'],
    prompt:
      'Build an interactive physics-based puzzle game with realistic gravity, collision restitution, and impulse forces. Include movable rigid body blocks, bouncy trampolines, gravity flip switches, laser obstacle beams, portal trigger zones, and 5 progressively challenging brain-teaser levels with star ratings.',
  },
];

const QUICK_PILLS = [
  { icon: '🕹️', label: '2D Platformer', id: 'platformer' },
  { icon: '🚀', label: 'Space Shooter', id: 'space-shooter' },
  { icon: '⚔️', label: 'Dungeon RPG', id: 'metroidvania' },
  { icon: '🧩', label: 'Physics Puzzle', id: 'physics-puzzle' },
  {
    icon: '🏎️',
    label: 'Pixel Racer',
    id: 'racer',
    prompt:
      'Create an arcade top-down pixel drift racing game. Feature authentic vehicle physics with tire drift friction, boost pads, oil slicks, checkpoint lap timing, competitive AI opponent cars, dynamic tire smoke particle trails, mini-map circuit radar, and a championship leaderboard.',
  },
  {
    icon: '🏓',
    label: 'Cyber Pong',
    id: 'pong',
    prompt:
      'Build a vibrant neon cyber brick breaker arcade game with smooth mouse paddle control, multi-ball powerups, explosive laser bricks, sound synthesizer audio, glowing neon trail effects, combo score multiplier, and satisfying particle bursts when bricks shatter.',
  },
];

export function StudioLandingSection({
  onSelectTemplate,
  onLaunchTemplate,
  onOpenSettings,
  fortzBalance,
}: StudioLandingSectionProps) {
  return (
    <div className="w-full flex flex-col items-center select-none pb-12">
      {/* ── 1. Hero Brand Header ── */}
      <div className="text-center px-4 pt-10 pb-4 max-w-4xl mx-auto">
        {/* Top Glowing Badges */}
        <div className="flex items-center justify-center gap-2.5 mb-4 flex-wrap">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/10 border border-cyan-400/30 text-[11px] font-bold tracking-widest text-cyan-300 uppercase shadow-[0_0_15px_rgba(6,182,212,0.25)] backdrop-blur-md animate-fade-in">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span>THEFORTZ STUDIO • POWERED BY AZURE AI</span>
          </div>
          {typeof fortzBalance === 'number' && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-yellow-400/40 text-[11px] font-bold tracking-wider text-yellow-300 shadow-[0_0_15px_rgba(234,179,8,0.2)] backdrop-blur-md animate-fade-in">
              <span>🪙</span>
              <span style={{ fontFamily: '"Lilita One", Anton, sans-serif' }}>{fortzBalance.toLocaleString()} FORTZ</span>
              <span className="text-[10px] text-yellow-200/70 font-normal ml-1">(10 / prompt)</span>
            </div>
          )}
        </div>

        {/* Hero Title with Luckiest Guy Font */}
        <h1
          className="animate-fade-in leading-tight tracking-wider uppercase text-cyan-300 mb-3"
          style={{
            fontFamily: "'Luckiest Guy', cursive, sans-serif",
            fontSize: 'clamp(34px, 6vw, 64px)',
            textShadow: '0 4px 0 #0a1450, 0 8px 0 #070e38, 0 12px 30px rgba(0, 248, 255, 0.45)',
          }}
        >
          Make Your Game Possible here.
        </h1>

        {/* Hero Subtitle */}
        <p className="text-sm sm:text-base text-blue-100/85 max-w-2xl mx-auto leading-relaxed font-medium">
          Create, code, and test complete 2D &amp; 3D browser games with instant AI code generation.
          100% free client-side WebAssembly hosting with 1-click publishing to the live TheFortz feed.
        </p>

        {/* ── Quick-Starter Pills (Horizontal Scroll/Wrap) ── */}
        <div className="flex items-center justify-center gap-2 flex-wrap mt-5 max-w-3xl mx-auto">
          <span className="text-xs font-bold text-blue-200/60 uppercase tracking-wider mr-1">
            Quick Start:
          </span>
          {QUICK_PILLS.map((pill) => {
            const template = TEMPLATES.find((t) => t.id === pill.id);
            const promptText = pill.prompt || template?.prompt || '';
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => onSelectTemplate(promptText)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 hover:border-cyan-400/60 text-white text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-sm"
              >
                <span>{pill.icon}</span>
                <span>{pill.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Note: The Prompt Input is rendered directly below this in BaseChat */}
    </div>
  );
}

export function StudioLandingFooter({
  onSelectTemplate,
  onLaunchTemplate,
}: {
  onSelectTemplate: (prompt: string) => void;
  onLaunchTemplate: (event: React.UIEvent, prompt: string) => void;
}) {
  return (
    <div className="w-full max-w-5xl mx-auto px-4 mt-6 pb-16 select-none">
      {/* ── 2. Featured Game Templates Grid (inspired by thefortz.me) ── */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-4 px-1">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎮</span>
            <h2
              className="text-base sm:text-lg font-black tracking-wider uppercase text-white font-['Anton',sans-serif]"
              style={{ letterSpacing: '0.06em' }}
            >
              Popular Game Templates
            </h2>
          </div>
          <span className="text-xs text-cyan-300/80 font-bold">Pick one to generate instantly</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {TEMPLATES.map((tmpl) => (
            <div
              key={tmpl.id}
              className="group relative rounded-xl bg-gradient-to-b from-[#182ea8]/90 to-[#101e74]/95 border border-white/20 hover:border-cyan-400/60 p-4 flex flex-col justify-between transition-all duration-200 hover:-translate-y-1 shadow-[0_10px_25px_rgba(0,0,0,0.4)] hover:shadow-[0_14px_30px_rgba(0,0,0,0.5),0_0_20px_rgba(6,182,212,0.25)]"
            >
              <div>
                {/* Top Badge + Icon */}
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-2xl">{tmpl.icon}</span>
                  <span
                    className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full text-white border"
                    style={{
                      background: `${tmpl.badgeColor}33`,
                      borderColor: `${tmpl.badgeColor}88`,
                      color: tmpl.badgeColor,
                    }}
                  >
                    {tmpl.badge}
                  </span>
                </div>

                <h3 className="text-sm font-extrabold text-white group-hover:text-cyan-300 transition-colors uppercase tracking-wide font-['Anton',sans-serif] mb-1">
                  {tmpl.title}
                </h3>
                <div className="text-[10px] font-bold text-blue-200/60 uppercase tracking-wider mb-2">
                  {tmpl.genre}
                </div>

                <p className="text-xs text-blue-100/80 leading-relaxed mb-3">
                  {tmpl.description}
                </p>

                {/* Features Bullet List */}
                <div className="space-y-1 mb-4">
                  {tmpl.features.map((feat, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 text-[11px] text-blue-200/90 font-medium">
                      <span className="text-cyan-400">✓</span>
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons: Try & Generate */}
              <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => onSelectTemplate(tmpl.prompt)}
                  className="flex-1 py-1.5 px-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all text-center cursor-pointer"
                >
                  Load Prompt
                </button>
                <button
                  type="button"
                  onClick={(e) => onLaunchTemplate(e, tmpl.prompt)}
                  className="py-1.5 px-3 rounded-lg bg-[#e26e03] hover:bg-[#f97316] text-white text-xs font-black uppercase tracking-wider transition-all shadow-md active:scale-95 cursor-pointer flex items-center gap-1"
                  title="Generate this game immediately"
                >
                  <span>Create</span>
                  <span>→</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 3. Live Engine Superpowers (Inspired by thefortz.me) ── */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-4 px-1">
          <span className="text-lg">⚡</span>
          <h2
            className="text-base sm:text-lg font-black tracking-wider uppercase text-white font-['Anton',sans-serif]"
            style={{ letterSpacing: '0.06em' }}
          >
            Engine Superpowers
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="rounded-xl bg-[#142690]/80 border border-white/15 p-4 flex flex-col gap-2">
            <div className="w-9 h-9 rounded-lg bg-cyan-400/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300 text-lg">
              ⚡
            </div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">
              Zero Server Costs
            </h4>
            <p className="text-xs text-blue-200/80 leading-relaxed">
              Games run 100% client-side in HTML5 Canvas &amp; WebAssembly. No backend hosting bills for you or your players.
            </p>
          </div>

          <div className="rounded-xl bg-[#142690]/80 border border-white/15 p-4 flex flex-col gap-2">
            <div className="w-9 h-9 rounded-lg bg-purple-400/20 border border-purple-400/40 flex items-center justify-center text-purple-300 text-lg">
              🤖
            </div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">
              Azure AI Engine
            </h4>
            <p className="text-xs text-blue-200/80 leading-relaxed">
              Synthesizes responsive physics engines, Web Audio sound effects, particle emitters, and multi-stage logic.
            </p>
          </div>

          <div className="rounded-xl bg-[#142690]/80 border border-white/15 p-4 flex flex-col gap-2">
            <div className="w-9 h-9 rounded-lg bg-emerald-400/20 border border-emerald-400/40 flex items-center justify-center text-emerald-300 text-lg">
              🚀
            </div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">
              1-Click Publishing
            </h4>
            <p className="text-xs text-blue-200/80 leading-relaxed">
              Download clean standalone ZIP archives or deploy straight to the global TheFortz feed with instant matchmaking.
            </p>
          </div>

          <div className="rounded-xl bg-[#142690]/80 border border-white/15 p-4 flex flex-col gap-2">
            <div className="w-9 h-9 rounded-lg bg-amber-400/20 border border-amber-400/40 flex items-center justify-center text-amber-300 text-lg">
              📊
            </div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">
              Live Creator Analytics
            </h4>
            <p className="text-xs text-blue-200/80 leading-relaxed">
              Track total plays, unique player sessions, likes, and creator earnings through the integrated analytics hub.
            </p>
          </div>
        </div>
      </div>

      {/* ── 4. Bottom Platform Banner ── */}
      <div className="rounded-xl bg-gradient-to-r from-[#101e74] via-[#162a9c] to-[#101e74] border border-cyan-400/30 p-5 flex items-center justify-between flex-wrap gap-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-cyan-400/20 border border-cyan-400/40 flex items-center justify-center text-xl">
            🕹️
          </div>
          <div>
            <h4 className="text-sm font-extrabold text-white uppercase tracking-wider font-['Anton',sans-serif]">
              Ready to play games created by other creators?
            </h4>
            <p className="text-xs text-blue-200/80">
              Browse hundreds of action, puzzle, RPG, and arcade games on the live platform.
            </p>
          </div>
        </div>
        <a
          href="https://thefortz.me"
          target="_blank"
          rel="noreferrer"
          className="py-2.5 px-5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-black uppercase tracking-wider rounded-lg transition-all shadow-md active:translate-y-0.5 no-underline flex items-center gap-1.5"
        >
          <span>Explore TheFortz Feed</span>
          <span>→</span>
        </a>
      </div>
    </div>
  );
}
