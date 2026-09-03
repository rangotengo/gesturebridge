import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ISample extends Document {
  features: number[];
  label: number;
  createdAt: Date;
  source: 'collection' | 'import' | 'seed';
  normalizationVersion: string;
  datasetRevision?: string;
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
  quarantined: { type: Boolean, default: false, index: true },
  quarantineReason: { type: String, maxlength: 256 },
  createdAt: { type: Date, default: Date.now },
});

sampleSchema.path('features').validate(
  (arr: number[]) => arr.every((value) => Number.isFinite(value) && value >= -1.0001 && value <= 1.0001),
  'Features must contain only finite numbers normalized in [-1, 1]'
);
sampleSchema.index({ label: 1, createdAt: -1 });
sampleSchema.index({ createdAt: -1 });

const Sample: Model<ISample> =
  mongoose.models.Sample ?? mongoose.model<ISample>('Sample', sampleSchema);

export default Sample;
