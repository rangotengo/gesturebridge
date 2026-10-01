import mongoose, { Schema, Document, Model } from 'mongoose';
import { isWristMaxAbsNormalized } from '../ml/featureContract';

export interface ISample extends Document {
  features: number[];
  label: number;
  createdAt: Date;
  source: 'collection' | 'import' | 'seed';
  normalizationVersion: string;
  datasetRevision?: string;
  participantId?: string;
  sessionId?: string;
  importBatchId?: string;
  quarantined?: boolean;
  quarantineReason?: string;
}

const sampleSchema = new Schema<ISample>({
  features: {
    type: [Number],
    required: true,
    validate: {
      validator: (arr: number[]) => arr.length === 63,
      message: 'Features array must have exactly 63 elements',
    },
  },
  label: { type: Number, required: true, min: 0, validate: Number.isInteger },
  source: { type: String, enum: ['collection', 'import', 'seed'], default: 'collection' },
  normalizationVersion: { type: String, default: 'wrist-maxabs-v1', maxlength: 64 },
  datasetRevision: { type: String, maxlength: 128 },
  participantId: { type: String, maxlength: 64, index: true },
  sessionId: { type: String, maxlength: 64, index: true },
  importBatchId: { type: String, maxlength: 64, index: true },
  quarantined: { type: Boolean, default: false, index: true },
  quarantineReason: { type: String, maxlength: 256 },
  createdAt: { type: Date, default: Date.now },
});

sampleSchema.path('features').validate(
  (arr: number[]) => isWristMaxAbsNormalized(arr),
  'Features must satisfy the non-degenerate wrist-maxabs-v1 contract (wrist at origin, scaled, finite numbers in [-1, 1])'
);
sampleSchema.index({ label: 1, createdAt: -1 });
sampleSchema.index({ createdAt: -1 });

const Sample: Model<ISample> =
  mongoose.models.Sample ?? mongoose.model<ISample>('Sample', sampleSchema);

export default Sample;
