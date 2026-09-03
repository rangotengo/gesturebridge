import mongoose, { type Model, Schema } from 'mongoose';

export type TrainingJobState = 'idle' | 'running' | 'succeeded' | 'failed';

export interface ITrainingResult {
  success: true;
  message: string;
  samplesCount: number;
  modelVersion: string;
  trainingAccuracy: number | null;
  validationAccuracy: number | null;
}

export interface ITrainingJob {
  _id: string;
  jobId: string | null;
  state: TrainingJobState;
  startedAt: Date | null;
  completedAt: Date | null;
  lastResult: ITrainingResult | null;
  errorCode: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const trainingResultSchema = new Schema<ITrainingResult>(
  {
    success: { type: Boolean, required: true },
    message: { type: String, required: true, maxlength: 256 },
    samplesCount: { type: Number, required: true, min: 0 },
    modelVersion: { type: String, required: true, maxlength: 128 },
    trainingAccuracy: { type: Number, default: null, min: 0, max: 1 },
    validationAccuracy: { type: Number, default: null, min: 0, max: 1 },
  },
  { _id: false }
);

const trainingJobSchema = new Schema<ITrainingJob>(
  {
    _id: { type: String, required: true },
    jobId: { type: String, default: null, maxlength: 128 },
    state: { type: String, enum: ['idle', 'running', 'succeeded', 'failed'], default: 'idle' },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastResult: { type: trainingResultSchema, default: null },
    errorCode: { type: String, default: null, maxlength: 128 },
    leaseOwner: { type: String, default: null, maxlength: 128 },
    leaseExpiresAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

trainingJobSchema.index({ state: 1, leaseExpiresAt: 1 });

const TrainingJob: Model<ITrainingJob> =
  mongoose.models.TrainingJob ?? mongoose.model<ITrainingJob>('TrainingJob', trainingJobSchema);

export default TrainingJob;
