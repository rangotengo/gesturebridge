import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IGesture extends Document {
  name: string;
  normalizedName?: string;
  labelIndex: number;
  isCustom: boolean;
  createdAt: Date;
}

const gestureSchema = new Schema<IGesture>({
  name: { type: String, required: true, unique: true, trim: true, minlength: 1, maxlength: 64 },
  normalizedName: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  labelIndex: { type: Number, required: true, unique: true, min: 0, validate: Number.isInteger },
  isCustom: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

interface IGestureCounter {
  _id: string;
  nextIndex: number;
}

const gestureCounterSchema = new Schema<IGestureCounter>({
  _id: { type: String, required: true },
  nextIndex: { type: Number, required: true, min: 0 },
}, { versionKey: false });

const Gesture: Model<IGesture> =
  mongoose.models.Gesture ?? mongoose.model<IGesture>('Gesture', gestureSchema);

export default Gesture;

export const GestureCounter: Model<IGestureCounter> =
  mongoose.models.GestureCounter ??
  mongoose.model<IGestureCounter>('GestureCounter', gestureCounterSchema);
