/**
 * Normalizes avatar URLs to ensure absolute addresses and avoid 404 relative requests.
 */
export function normalizeAvatarUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  if (trimmed.includes('/avatars/initials') || trimmed.includes('ui-avatars.com')) {
    return '';
  }

  // Already a full absolute URL or data URI
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('data:')) {
    return trimmed;
  }

  // Discord avatar filename or hash without full origin
  if (trimmed.includes('346f7ce283c24a248b435f41acd3a081') || /^[a-f0-9]{32}/i.test(trimmed)) {
    const cleanHash = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
    return `https://cdn.discordapp.com/avatars/1440344883914080280/${cleanHash}`;
  }

  // Any relative path without an origin would trigger a 404 against the host domain
  return '';
}
