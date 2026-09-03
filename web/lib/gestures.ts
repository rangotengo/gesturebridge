import Gesture, { GestureCounter, type IGesture } from '@/models/Gesture';
import type { ClientSession } from 'mongoose';

export const DEFAULT_GESTURES = ['Pointing', 'Fist', 'Peace', 'Open Palm', 'Rock', 'Thumb'] as const;

export function normalizeGestureName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function getGestureCanonicalName(name: string): string {
  return normalizeGestureName(name).toLocaleLowerCase('en-US');
}

export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface GestureWriteOptions {
  session?: ClientSession;
}

export async function ensureDefaultGestures(options: GestureWriteOptions = {}): Promise<void> {
  const { session } = options;
  for (const [index, name] of DEFAULT_GESTURES.entries()) {
    const normalizedName = getGestureCanonicalName(name);
    const existingQuery = Gesture.findOne({
      $or: [{ labelIndex: index }, { normalizedName }, { name }],
    });
    if (session) existingQuery.session(session);
    const existing = await existingQuery;

    if (!existing) {
      const gesture = new Gesture({ name, normalizedName, labelIndex: index, isCustom: false });
      await gesture.save({ session });
      continue;
    }

    // Backfill the canonical key without changing an existing label mapping.
    if (existing.labelIndex === index) {
      existing.name = name;
      existing.normalizedName = normalizedName;
      existing.isCustom = false;
      await existing.save({ session });
    }
  }

  await synchronizeGestureCounter(options);
}

async function synchronizeGestureCounter(options: GestureWriteOptions = {}): Promise<void> {
  const maxGestureQuery = Gesture.findOne({}, { labelIndex: 1 }).sort({ labelIndex: -1 }).lean();
  if (options.session) maxGestureQuery.session(options.session);
  const maxGesture = await maxGestureQuery;
  await GestureCounter.updateOne(
    { _id: 'labelIndex' },
    { $max: { nextIndex: (maxGesture?.labelIndex ?? -1) + 1 } },
    { upsert: true, session: options.session }
  );
}

async function allocateGestureLabelIndex(options: GestureWriteOptions = {}): Promise<number> {
  await synchronizeGestureCounter(options);
  const counterQuery = GestureCounter.findOneAndUpdate(
    { _id: 'labelIndex' },
    { $inc: { nextIndex: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  if (options.session) counterQuery.session(options.session);
  const counter = await counterQuery;
  if (!counter) throw new Error('Unable to allocate a gesture label.');
  return counter.nextIndex - 1;
}

export async function findOrCreateGesture(
  rawName: string,
  options: GestureWriteOptions = {}
): Promise<{
  gesture: IGesture;
  created: boolean;
}> {
  const { session } = options;
  const name = normalizeGestureName(rawName);
  const normalizedName = getGestureCanonicalName(name);
  const existingQuery = Gesture.findOne({
    $or: [
      { normalizedName },
      { name: { $regex: new RegExp(`^${escapeRegexLiteral(name)}$`, 'i') } },
    ],
  });
  if (session) existingQuery.session(session);
  const existing = await existingQuery;
  if (existing) {
    if (!existing.normalizedName) {
      existing.normalizedName = normalizedName;
      await existing.save({ session });
    }
    return { gesture: existing, created: false };
  }

  const labelIndex = await allocateGestureLabelIndex(options);
  try {
    const gesture = new Gesture({ name, normalizedName, labelIndex, isCustom: true });
    await gesture.save({ session });
    return { gesture, created: true };
  } catch (error) {
    // A transaction cannot safely continue after a duplicate-key error; callers
    // using a session retry the whole transaction. The non-transactional routes
    // retain the existing race recovery behavior.
    if (session) throw error;
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      const racedGesture = await Gesture.findOne({ normalizedName });
      if (racedGesture) return { gesture: racedGesture, created: false };
    }
    throw error;
  }
}

export async function getKnownGestureLabelSet(): Promise<Set<number>> {
  await ensureDefaultGestures();
  const gestures = await Gesture.find({}, { labelIndex: 1 }).lean();
  return new Set(gestures.map((gesture) => gesture.labelIndex));
}
