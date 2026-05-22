import TSV_DATA from './data/Fracture.tsv?raw';

export interface CardTemplate {
  faction: string;
  type: string;
  count: number;
  name: string;
  tier: number | null;
  stat: string;
  desc: string;
}

export interface GameCard extends CardTemplate {
  id: number;
  faceDown: boolean;
  x: number;
  y: number;
  zIndex: number;
  stackedUnder: number | null;
  stackCount: number;
}

export function parseTSV(tsv: string): CardTemplate[] {
  const lines = tsv
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) return [];

  const headers = lines[0].split('\t').map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const values = line.split('\t').map((v) => v.trim());
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });

    const tierRaw = row['тир'];
    const parsedTier =
      !tierRaw || tierRaw === '—' ? null : Number.parseInt(tierRaw, 10);

    return {
      faction: row['фракция'] || '',
      type: row['тип'] || '',
      count: Number.parseInt(row['кол-во'] || '1', 10) || 1,
      name: row['название'] || '',
      tier: Number.isNaN(parsedTier) ? null : parsedTier,
      stat: row['дистанция/защита/хп'] || '—',
      desc: row['описание'] || '—',
    };
  });
}

export const CARD_TEMPLATES = parseTSV(TSV_DATA);

export function buildDeck(templates: CardTemplate[] = CARD_TEMPLATES): GameCard[] {
  const deck: GameCard[] = [];
  let id = 0;

  for (const template of templates) {
    for (let i = 0; i < template.count; i++) {
      deck.push({
        ...template,
        id: id++,
        faceDown: false,
        x: 0,
        y: 0,
        zIndex: 0,
        stackedUnder: null,
        stackCount: 0,
      });
    }
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

export const FACTION_COLORS: Record<string, string> = {
  Наследие: '#4d59ca',
  Ткачи: '#991b84',
  Скраперы: '#8b3412',
  Биотек: '#0e861e',
  Техновирус: '#d40606',
};

export const TYPE_COLORS: Record<string, string> = {
  Оружие: '#ef4444',
  Броня: '#3b82f6',
  Модуль: '#22c55e',
  Строение: '#f59e0b',
};