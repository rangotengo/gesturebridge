import type { GestureRecord } from '@/features/gestures/queries';

export type CsvLabelColumn = 'last' | 'first' | 'auto';

export interface ParsedImportSample {
  features: number[];
  /** -1 means the exact string label is intentionally unresolved until import. */
  label: number;
  rawStringLabel?: string;
}

export interface ParsedImportDataset {
  samples: ParsedImportSample[];
  invalidCount: number;
  unresolvedNames: string[];
}

interface JsonItem {
  features?: unknown;
  label?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveLabel(rawLabel: unknown, gestures: GestureRecord[]): number {
  if (typeof rawLabel !== 'string' && typeof rawLabel !== 'number') return -2;
  const cleaned = String(rawLabel).trim();
  if (!cleaned) return -2;

  const numericValue = Number(cleaned);
  if (Number.isFinite(numericValue)) {
    return Number.isInteger(numericValue) && gestures.some((gesture) => gesture.labelIndex === numericValue)
      ? numericValue
      : -2;
  }

  const existingGesture = gestures.find(
    (gesture) => gesture.name.trim().toLocaleLowerCase() === cleaned.toLocaleLowerCase()
  );
  return existingGesture ? existingGesture.labelIndex : -1;
}

function addSample(
  samples: ParsedImportSample[],
  unresolvedNames: Set<string>,
  features: unknown,
  rawLabel: unknown,
  gestures: GestureRecord[]
): boolean {
  const numericFeatures = Array.isArray(features) ? features.map(Number) : [];
  if (numericFeatures.length !== 63 || !numericFeatures.every(Number.isFinite)) return false;

  const label = resolveLabel(rawLabel, gestures);
  if (label >= 0) {
    samples.push({ features: numericFeatures, label });
    return true;
  }
  if (label === -1 && typeof rawLabel === 'string') {
    const rawStringLabel = rawLabel.trim();
    samples.push({ features: numericFeatures, label, rawStringLabel });
    unresolvedNames.add(rawStringLabel);
    return true;
  }
  return false;
}

function finish(
  samples: ParsedImportSample[],
  invalidCount: number,
  unresolvedNames: Set<string>,
  emptyMessage: string
): ParsedImportDataset {
  if (samples.length === 0) throw new Error(emptyMessage);
  return { samples, invalidCount, unresolvedNames: [...unresolvedNames] };
}

export function parseJsonDataset(text: string, gestures: GestureRecord[]): ParsedImportDataset {
  const parsed: unknown = JSON.parse(text);
  const data = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.samples)
      ? parsed.samples
      : isRecord(parsed) && Array.isArray(parsed.data)
        ? parsed.data
        : null;
  if (!data) throw new Error('JSON must contain an array of samples.');

  const samples: ParsedImportSample[] = [];
  const unresolvedNames = new Set<string>();
  let invalidCount = 0;
  for (const item of data) {
    if (!isRecord(item) || !addSample(samples, unresolvedNames, (item as JsonItem).features, (item as JsonItem).label, gestures)) {
      invalidCount += 1;
    }
  }
  return finish(samples, invalidCount, unresolvedNames, 'No valid samples found in the JSON file.');
}

/** Parses a RFC 4180-style row including escaped quotes. */
export function parseCsvRow(line: string): string[] | null {
  const values: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += character;
    }
  }
  if (quoted) return null;
  values.push(value.trim());
  return values;
}

function isValidFeatureRow(parts: string[], labelColumn: 'first' | 'last'): boolean {
  if (parts.length !== 64) return false;
  const featureValues = labelColumn === 'first' ? parts.slice(1) : parts.slice(0, 63);
  return featureValues.length === 63 && featureValues.every((value) => Number.isFinite(Number(value)));
}

function detectLabelColumn(rows: string[][]): 'first' | 'last' {
  let firstScore = 0;
  let lastScore = 0;
  for (const row of rows.slice(0, 20)) {
    if (isValidFeatureRow(row, 'first')) firstScore += 1;
    if (isValidFeatureRow(row, 'last')) lastScore += 1;
  }
  return firstScore > lastScore ? 'first' : 'last';
}

export function parseCsvDataset(
  text: string,
  gestures: GestureRecord[],
  labelColumn: CsvLabelColumn = 'last'
): ParsedImportDataset {
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map(parseCsvRow);
  const chosenColumn = labelColumn === 'auto'
    ? detectLabelColumn(rows.filter((row): row is string[] => row !== null))
    : labelColumn;
  const samples: ParsedImportSample[] = [];
  const unresolvedNames = new Set<string>();
  let invalidCount = 0;

  for (const row of rows) {
    if (!row || !isValidFeatureRow(row, chosenColumn)) {
      invalidCount += 1;
      continue;
    }
    const rawLabel = row[chosenColumn === 'first' ? 0 : 63];
    const features = chosenColumn === 'first' ? row.slice(1) : row.slice(0, 63);
    if (!addSample(samples, unresolvedNames, features, rawLabel, gestures)) invalidCount += 1;
  }
  return finish(
    samples,
    invalidCount,
    unresolvedNames,
    'No valid samples parsed. Each row needs 63 finite coordinates and one known integer or named gesture label.'
  );
}

export function parseImportDataset(
  text: string,
  fileName: string,
  gestures: GestureRecord[],
  labelColumn: CsvLabelColumn
): ParsedImportDataset {
  const normalizedName = fileName.toLocaleLowerCase();
  if (normalizedName.endsWith('.json')) return parseJsonDataset(text, gestures);
  if (normalizedName.endsWith('.csv')) return parseCsvDataset(text, gestures, labelColumn);
  throw new Error('Unsupported file extension. Please upload a .json or .csv file.');
}
