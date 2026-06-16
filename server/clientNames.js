function normalizeClientKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('pt-BR');
}

export const defaultClientAliases = [
  { alias: 'ACADEMIA STRIKE TEAM', canonicalName: 'ACADEMIA STRIKE TEAM' },
  { alias: 'STRIKE TEAM', canonicalName: 'ACADEMIA STRIKE TEAM' },
  { alias: 'ACADEMIA STRIKE', canonicalName: 'ACADEMIA STRIKE TEAM' },
  { alias: 'STRIKE', canonicalName: 'ACADEMIA STRIKE TEAM' },
].map((entry) => ({
  alias: normalizeClientKey(entry.alias),
  canonicalName: normalizeClientKey(entry.canonicalName),
}));

const aliasMap = new Map(defaultClientAliases.map((entry) => [entry.alias, entry.canonicalName]));

export function normalizeClientName(value) {
  const normalized = normalizeClientKey(value);
  return aliasMap.get(normalized) || normalized;
}
