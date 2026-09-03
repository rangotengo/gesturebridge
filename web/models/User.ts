import mongoose, { Schema, Document, Model } from 'mongoose';

export type UserRole = 'admin';

export interface IUser extends Document {
  email: string;
  /** Current bcrypt hash field. */
  passwordHash?: string;
  /** Legacy field from older app builds — migrated to passwordHash on login. */
  password?: string;
  role: UserRole;
  bootstrapSlot?: number;
  createdAt: Date;
}

const userSchema = new Schema<IUser>({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    maxlength: 254,
  },
  passwordHash: {
    type: String,
    required: false,
    minlength: 20,
  },
  // Legacy plaintext-hash field from the old Express User model
  password: {
    type: String,
    required: false,
    select: true,
  },
  role: {
    type: String,
    enum: ['admin'],
    required: true,
    default: 'admin',
  },
  bootstrapSlot: {
    type: Number,
    unique: true,
    sparse: true,
    default: 1,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const User: Model<IUser> =
  mongoose.models.User ?? mongoose.model<IUser>('User', userSchema);

export default User;
