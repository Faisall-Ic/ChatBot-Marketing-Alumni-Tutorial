import mongoose from 'mongoose';

const chatLogSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, index: true },
    role: { type: String, enum: ['user', 'model'], required: true },
    message: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  {
    collection: 'chat_logs',
    versionKey: false,
  }
);

chatLogSchema.index({ phone: 1, createdAt: -1 });

const ChatLog = mongoose.models.ChatLog || mongoose.model('ChatLog', chatLogSchema);
export default ChatLog;
