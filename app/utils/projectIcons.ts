/**
 * Dynamic project icon resolver based on game/app title keywords
 */
export function getProjectIcon(title: string = ''): { icon: string; color: string } {
  const t = title.toLowerCase();
  if (t.includes('platform') || t.includes('jump') || t.includes('jack') || t.includes('mario') || t.includes('run')) {
    return { icon: 'i-ph:game-controller-fill', color: 'text-sky-400' };
  }
  if (t.includes('race') || t.includes('car') || t.includes('drift') || t.includes('rocket') || t.includes('speed')) {
    return { icon: 'i-ph:rocket-launch-fill', color: 'text-orange-400' };
  }
  if (t.includes('shoot') || t.includes('bullet') || t.includes('space') || t.includes('blaster') || t.includes('gun') || t.includes('hell')) {
    return { icon: 'i-ph:crosshair-simple-bold', color: 'text-rose-400' };
  }
  if (t.includes('rpg') || t.includes('dungeon') || t.includes('sword') || t.includes('quest') || t.includes('craft') || t.includes('adventure')) {
    return { icon: 'i-ph:sword-fill', color: 'text-amber-400' };
  }
  if (t.includes('puzzle') || t.includes('brick') || t.includes('breakout') || t.includes('ball') || t.includes('block')) {
    return { icon: 'i-ph:puzzle-piece-fill', color: 'text-emerald-400' };
  }
  if (t.includes('audio') || t.includes('sound') || t.includes('music') || t.includes('synth')) {
    return { icon: 'i-ph:speaker-high-fill', color: 'text-violet-400' };
  }
  return { icon: 'i-ph:code-bold', color: 'text-sky-300' };
}
