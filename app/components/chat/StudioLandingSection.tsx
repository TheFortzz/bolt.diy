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

export const QUICK_PILLS = [
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
    <div className="w-full flex flex-col items-center select-none pt-4 pb-2 px-4">
      {/* ── Compact Replit-Style Search Hero ── */}
      <div className="text-center max-w-3xl mx-auto mb-3">
        <div className="inline-flex items-center gap-2 mb-2 px-2.5 py-1 bg-[#1a233a] border border-[#38bdf8]/30 text-[11px] font-mono font-bold tracking-wider">
          <span className="text-[#f97316]">⚡</span>
          <span className="text-[#38bdf8]">THEFORTZ STUDIO</span>
          <span className="text-slate-400">•</span>
          <span className="text-slate-300">AI GAME ENGINE</span>
        </div>

        <h1
          className="text-2xl sm:text-3xl font-black uppercase tracking-wider text-white font-['Anton',sans-serif] mb-1"
        >
          What do you want to <span className="text-[#f97316]">build</span>?
        </h1>

        <p className="text-xs sm:text-sm text-slate-300 max-w-xl mx-auto font-medium">
          Type any game prompt below. The AI creates, compiles, and tests your game live in your browser.
        </p>
      </div>
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
  return null;
}

