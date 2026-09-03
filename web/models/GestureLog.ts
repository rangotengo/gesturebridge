import mongoose, { Schema, Document, Model } from 'mongoose';
import { CONTROL_MODES, type ControlMode } from '@/features/control/modes';

export interface IGestureLog extends Document {
  gesture: string;
  confidence: number;
  platform: 'browser' | 'desktop';
  mode: ControlMode;
  timestamp: Date;
}

const gestureLogSchema = new Schema<IGestureLog>({
  gesture: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
  confidence: { type: Number, required: true, min: 0, max: 1 },
  platform: { type: String, enum: ['browser', 'desktop'], required: true },
  mode: { type: String, enum: CONTROL_MODES, required: true },
  timestamp: { type: Date, default: Date.now },
});

gestureLogSchema.index({ timestamp: -1 });

const GestureLog: Model<IGestureLog> =
  mongoose.models.GestureLog ?? mongoose.model<IGestureLog>('GestureLog', gestureLogSchema);

export default GestureLog;
