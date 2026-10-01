import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import Sample from '@/models/Sample';
import { normalizeLandmarks, type Landmark } from '@/ml/gestureUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getKnownGestureLabelSet } from '@/lib/gestures';
import { internalServerError, rateLimit, requireSameOrigin } from '@/lib/requestGuards';
import { validateSampleBatch } from '@/lib/sampleValidation';

export const runtime = 'nodejs';

interface FingerConfig {
  index: 'up' | 'down';
  middle: 'up' | 'down';
  ring: 'up' | 'down';
  pinky: 'up' | 'down';
  thumb: 'up' | 'down';
}

const GESTURE_CONFIGS: Record<number, FingerConfig> = {
  0: { index: 'up', middle: 'down', ring: 'down', pinky: 'down', thumb: 'down' }, // Pointing
  1: { index: 'down', middle: 'down', ring: 'down', pinky: 'down', thumb: 'down' }, // Fist
  2: { index: 'up', middle: 'up', ring: 'down', pinky: 'down', thumb: 'down' }, // Peace
  3: { index: 'up', middle: 'up', ring: 'up', pinky: 'up', thumb: 'up' }, // Open Palm
  4: { index: 'up', middle: 'down', ring: 'down', pinky: 'up', thumb: 'down' }, // Rock
  5: { index: 'down', middle: 'down', ring: 'down', pinky: 'down', thumb: 'up' }, // Thumb
};

function addNoise(val: number, amp = 0.02): number {
  return val + (Math.random() - 0.5) * amp;
}

function generateHandLandmarks(config: FingerConfig): Landmark[] {
  const lm = (x: number, y: number, z = 0): Landmark => ({
    x: addNoise(x),
    y: addNoise(y),
    z: addNoise(z, 0.01),
  });

  const wrist: Landmark = { x: 0, y: 0, z: 0 };

  const thumb_1 = lm(0.1, -0.1);
  const thumb_2 = config.thumb === 'up' ? lm(0.2, -0.15) : lm(0.15, -0.15);
  const thumb_3 = config.thumb === 'up' ? lm(0.28, -0.18) : lm(0.05, -0.15);
  const thumb_4 = config.thumb === 'up' ? lm(0.35, -0.2) : lm(0.1, -0.15);

  const index_5 = lm(0.15, -0.3);
  const index_6 = lm(0.18, -0.42);
  const index_7 = config.index === 'up' ? lm(0.2, -0.5) : lm(0.14, -0.25);
  const index_8 = config.index === 'up' ? lm(0.21, -0.58) : lm(0.13, -0.2);

  const middle_9 = lm(0.05, -0.32);
  const middle_10 = lm(0.06, -0.45);
  const middle_11 = config.middle === 'up' ? lm(0.07, -0.54) : lm(0.05, -0.26);
  const middle_12 = config.middle === 'up' ? lm(0.08, -0.64) : lm(0.05, -0.2);

  const ring_13 = lm(-0.05, -0.3);
  const ring_14 = lm(-0.06, -0.42);
  const ring_15 = config.ring === 'up' ? lm(-0.07, -0.5) : lm(-0.05, -0.25);
  const ring_16 = config.ring === 'up' ? lm(-0.08, -0.58) : lm(-0.05, -0.2);

  const pinky_17 = lm(-0.15, -0.26);
  const pinky_18 = lm(-0.18, -0.36);
  const pinky_19 = config.pinky === 'up' ? lm(-0.19, -0.44) : lm(-0.13, -0.22);
  const pinky_20 = config.pinky === 'up' ? lm(-0.2, -0.5) : lm(-0.12, -0.18);

  return [
    wrist,
    thumb_1, thumb_2, thumb_3, thumb_4,
    index_5, index_6, index_7, index_8,
    middle_9, middle_10, middle_11, middle_12,
    ring_13, ring_14, ring_15, ring_16,
    pinky_17, pinky_18, pinky_19, pinky_20,
  ];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const originError = requireSameOrigin(req);
  if (originError) return originError;

  const rateLimitError = rateLimit(req, 'ml:seed', 3, 10 * 60_000);
  if (rateLimitError) return rateLimitError;

  try {
    await connectDB();

    const SAMPLES_PER_GESTURE = 30;
    const generated: { features: number[]; label: number; participantId?: string; sessionId?: string }[] = [];

    for (let label = 0; label < 6; label++) {
      const config = GESTURE_CONFIGS[label];
      if (!config) continue;

      for (let s = 0; s < SAMPLES_PER_GESTURE; s++) {
        const landmarks = generateHandLandmarks(config);
        const normalized = normalizeLandmarks(landmarks);
        const participantNum = (s % 4) + 1;
        generated.push({
          features: normalized,
          label,
          participantId: `participant-0${participantNum}`,
          sessionId: `session-p0${participantNum}-g0${label}`,
        });
      }
    }

    const knownLabels = await getKnownGestureLabelSet();
    const validation = validateSampleBatch(generated, knownLabels, generated.length);
    if (validation.accepted.length === 0) {
      return NextResponse.json({
        error: 'Generated seed samples were not valid.',
        rejectedCount: validation.rejected.length,
        rejected: validation.rejected.slice(0, 25),
      }, { status: 500 });
    }

    await Sample.insertMany(validation.accepted.map((sample) => ({ ...sample, source: 'seed' })));
    const count = await Sample.countDocuments();

    return NextResponse.json({
      success: true,
      message: `Successfully generated and seeded ${validation.accepted.length} high-quality synthetic training samples (30 per gesture) in MongoDB. Total samples: ${count}.`,
      seededCount: validation.accepted.length,
      rejectedCount: validation.rejected.length,
      totalCount: count,
    });
  } catch (err) {
    return internalServerError('ml:seed', err);
  }
}
