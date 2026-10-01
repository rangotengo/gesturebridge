import mongoose, { type Model, Schema, type Document } from 'mongoose';
import type { PerGestureMetric, SplitStrategy } from '@/ml/trainingHelpers';

export interface IEvaluationRun extends Document {
  modelVersion: string;
  datasetRevision: string;
  samplesCount: number;
  classCount: number;
  splitStrategy: SplitStrategy;
  parameters: {
    epochs: number;
    batchSize: number;
    learningRate: number;
    optimizer: string;
  };
  metrics: {
    trainingAccuracy: number;
    validationAccuracy: number;
    macroF1: number;
    macroPrecision: number;
    macroRecall: number;
    weightedF1: number;
    perGestureMetrics: PerGestureMetric[];
    confusionMatrix: number[][];
  };
  labels: Array<{ labelIndex: number; name: string }>;
  createdAt: Date;
}

const perGestureMetricSchema = new Schema(
  {
    labelIndex: { type: Number, required: true },
    name: { type: String, required: true },
    precision: { type: Number, required: true },
    recall: { type: Number, required: true },
    f1Score: { type: Number, required: true },
    support: { type: Number, required: true },
  },
  { _id: false }
);

const evaluationRunSchema = new Schema<IEvaluationRun>(
  {
    modelVersion: { type: String, required: true, index: true },
    datasetRevision: { type: String, required: true, index: true },
    samplesCount: { type: Number, required: true },
    classCount: { type: Number, required: true },
    splitStrategy: {
      type: String,
      enum: ['grouped-participant', 'grouped-session', 'stratified-random'],
      required: true,
    },
    parameters: {
      epochs: { type: Number, required: true },
      batchSize: { type: Number, required: true },
      learningRate: { type: Number, required: true },
      optimizer: { type: String, required: true },
    },
    metrics: {
      trainingAccuracy: { type: Number, required: true },
      validationAccuracy: { type: Number, required: true },
      macroF1: { type: Number, required: true },
      macroPrecision: { type: Number, required: true },
      macroRecall: { type: Number, required: true },
      weightedF1: { type: Number, required: true },
      perGestureMetrics: { type: [perGestureMetricSchema], required: true },
      confusionMatrix: { type: [[Number]], required: true },
    },
    labels: [
      {
        labelIndex: { type: Number, required: true },
        name: { type: String, required: true },
        _id: false,
      },
    ],
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

evaluationRunSchema.index({ createdAt: -1 });

const EvaluationRun: Model<IEvaluationRun> =
  mongoose.models.EvaluationRun ||
  mongoose.model<IEvaluationRun>('EvaluationRun', evaluationRunSchema);

export default EvaluationRun;
