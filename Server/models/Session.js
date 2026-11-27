import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ['active', 'escalated'],
      default: 'active',
    },
    lastInteractionAt: { type: Date, default: Date.now },
    escalatedAt: { type: Date, default: null },
    contextResetAt: { type: Date, default: null },
  },
  {
    collection: 'sessions',
    versionKey: false,
  }
);

const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);
export default Session;
