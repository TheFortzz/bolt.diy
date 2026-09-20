import React, { useState } from 'react';

interface CommunityGame {
  id: string;
  title: string;
  genre: string;
  creator: string;
  plays: number;
  likes: number;
  thumbUrl?: string;
  description: string;
  prompt: string;
}

const COMMUNITY_GAMES: CommunityGame[] = [
  {
    id: 'game_little_jack',
    title: 'Little Jack',
    genre: 'PLATFORMER',
    creator: 'Amanuel Assefa',
    plays: 1420,
    likes: 312,
    thumbUrl: 'https://thefortz.me/thumbs/little-jack.jpg',
    description: 'Fast-paced retro platformer with fireball powerups, double jumps, moving platforms, and spike hazard traps.',
    prompt: 'Create a complete retro 2D platformer named Little Jack with smooth run acceleration, gravity, double jump, wall slide, collectible gold coins, dangerous hazard spikes, stomping enemies with patrol AI, a live HUD with score, coins, and lives, sound effects using Web Audio API synth, and fireball shooting.',
  },
  {
    id: 'game_the_craft',
    title: 'TheCraft Drift',
    genre: 'RACING',
    creator: 'NeonRider',
    plays: 980,
    likes: 215,
    thumbUrl: 'https://thefortz.me/thumbs/thecraft.jpg',
    description: 'Arcade top-down drifting racer with tire smoke particles, checkpoint lap timing, and rival AI racers.',
    prompt: 'Create an arcade top-down pixel drift racing game named TheCraft. Feature authentic vehicle physics with tire drift friction, boost pads, oil slicks, checkpoint lap timing, competitive AI opponent cars, dynamic tire smoke particle trails, and circuit radar.',
  },
  {
    id: 'game_orbital_bullet_hell',
    title: 'Orbital Bullet Hell',
    genre: 'ACTION • ARCADE',
    creator: 'VortexDev',
    plays: 2450,
    likes: 540,
    description: '360-degree space shooter with homing missiles, laser beams, intense screen shake, and boss bullet patterns.',
    prompt: 'Build a high-intensity retro top-down space bullet hell shooter. Include 360-degree player movement with thruster particle trails, mouse aim shooting with multiple weapon upgrades (spread shot, laser beam, homing missiles), procedural wave spawning of alien ships, intense screen shake on explosions, and an epic multi-phase boss fight.',
  },
  {
    id: 'game_dungeon_crawler',
    title: 'Dungeon Crawler RPG',
    genre: 'ADVENTURE • RPG',
    creator: 'ShadowMage',
    plays: 1890,
    likes: 420,
    description: 'Top-down dungeon crawler with sword slash combos, invulnerability dash, keys, locked doors, and boss AI.',
    prompt: 'Create a rich 2D top-down dungeon crawler adventure RPG. Feature player combat (sword slash attack, dash dodge with invulnerability frames), health and mana HUD, multiple enemy types (slime, skeleton archer), inventory system with key pickups to unlock sealed doors, chest loot with weapon upgrades, and an ominous dungeon boss.',
  },
  {
    id: 'game_physics_sandbox',
    title: 'Kinematic Sandbox',
    genre: 'PUZZLE • PHYSICS',
    creator: 'GravityLab',
    plays: 1120,
    likes: 280,
    description: 'Physics puzzle with gravity flip switches, bouncy trampolines, laser beam obstacles, and trigger portals.',
    prompt: 'Build an interactive physics-based puzzle game with realistic gravity, collision restitution, and impulse forces. Include movable rigid body blocks, bouncy trampolines, gravity flip switches, laser obstacle beams, portal trigger zones, and 5 progressively challenging brain-teaser levels.',
  },
  {
    id: 'game_cyber_pong',
    title: 'Neon Cyber Breakout',
    genre: 'ARCADE',
    creator: 'SynthWave',
    plays: 870,
    likes: 195,
    description: 'Vibrant neon brick breaker with explosive lasers, multiball powerups, combo multipliers, and audio synthesis.',
    prompt: 'Build a vibrant neon cyber brick breaker arcade game with smooth mouse paddle control, multi-ball powerups, explosive laser bricks, sound synthesizer audio, glowing neon trail effects, combo score multiplier, and satisfying particle bursts when bricks shatter.',
  },
];

interface CommunityGalleryModalProps {
  open: boolean;
  onClose: () => void;
  onSelectPrompt: (prompt: string) => void;
}

export function CommunityGalleryModal({ open, onClose, onSelectPrompt }: CommunityGalleryModalProps) {
  const [activeGenre, setActiveGenre] = useState<string>('ALL');

  if (!open) return null;

  const genres = ['ALL', 'PLATFORMER', 'ACTION • ARCADE', 'RACING', 'ADVENTURE • RPG', 'PUZZLE • PHYSICS'];

  const filteredGames = activeGenre === 'ALL'
    ? COMMUNITY_GAMES
    : COMMUNITY_GAMES.filter((g) => g.genre === activeGenre);

  const handleOpenPlatformGames = () => {
    if (typeof window !== 'undefined') {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'thefortz-switch-tab', tab: 'games' }, '*');
      }
      window.open('https://thefortz.me', '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md select-none animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] bg-[#152642] border border-[#38bdf8]/40 flex flex-col relative overflow-hidden"
        style={{ borderRadius: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#38bdf8]/30 bg-[#1c3258]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-[#233e6c] border border-[#38bdf8]/40 flex items-center justify-center text-[#38bdf8]">
              <div className="i-ph:game-controller-fill text-lg" />
            </div>
            <div>
              <h2 className="text-base font-black uppercase tracking-wider text-white font-['Anton',sans-serif]">
                Community Games Gallery
              </h2>
              <p className="text-[11px] text-sky-200/70">
                Explore games created by other developers. Click to remix and build your own version!
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenPlatformGames}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-[#233e6c] hover:bg-[#2b4c84] text-sky-300 hover:text-white border border-[#38bdf8]/40 text-xs font-bold transition-all cursor-pointer"
              style={{ borderRadius: 0 }}
              title="Open full Games tab on the main platform"
            >
              <span>Explore All on Platform</span>
              <span className="text-xs">↗</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              style={{ borderRadius: 0 }}
              title="Close Gallery"
            >
              <div className="i-ph:x-bold text-base" />
            </button>
          </div>
        </div>

        {/* Genre Filter Pills */}
        <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-white/10 bg-[#182a4a] overflow-x-auto no-scrollbar">
          {genres.map((genre) => (
            <button
              key={genre}
              onClick={() => setActiveGenre(genre)}
              className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer ${
                activeGenre === genre
                  ? 'bg-[#38bdf8] text-black'
                  : 'bg-[#1e355c] hover:bg-[#264374] text-sky-200 border border-white/10'
              }`}
              style={{ borderRadius: 0 }}
            >
              {genre}
            </button>
          ))}
        </div>

        {/* Games Grid List */}
        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredGames.map((game) => (
            <div
              key={game.id}
              className="bg-[#1c3258] border border-[#38bdf8]/25 hover:border-[#38bdf8] transition-all flex flex-col justify-between group overflow-hidden"
              style={{ borderRadius: 0 }}
            >
              {/* Game Thumbnail Header */}
              <div className="h-36 w-full bg-[#132238] border-b border-white/10 relative overflow-hidden flex items-center justify-center">
                {game.thumbUrl ? (
                  <img
                    src={game.thumbUrl}
                    alt={game.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="text-4xl opacity-70">🎮</div>
                )}
                <div className="absolute top-2 left-2 px-2 py-0.5 bg-[#152642]/90 border border-sky-400/40 text-[10px] font-bold text-sky-300 uppercase tracking-wide">
                  {game.genre}
                </div>
                <div className="absolute bottom-2 right-2 flex items-center gap-2 px-2 py-0.5 bg-[#152642]/90 border border-white/10 text-[10px] text-slate-300 font-mono">
                  <span>▶ {game.plays}</span>
                  <span>❤️ {game.likes}</span>
                </div>
              </div>

              {/* Game Info */}
              <div className="p-3.5 flex-1 flex flex-col justify-between">
                <div>
                  <h3 className="font-bold text-sm text-white group-hover:text-sky-300 transition-colors">
                    {game.title}
                  </h3>
                  <div className="text-[11px] text-sky-300/80 mb-2 font-mono">
                    by {game.creator}
                  </div>
                  <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                    {game.description}
                  </p>
                </div>

                {/* Remix Button */}
                <button
                  type="button"
                  onClick={() => {
                    onSelectPrompt(game.prompt);
                    onClose();
                  }}
                  className="mt-3 w-full py-2 px-3 bg-[#f97316] hover:bg-[#ea580c] text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  style={{ borderRadius: 0 }}
                >
                  <span>⚡</span>
                  <span>Remix & Build This</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
