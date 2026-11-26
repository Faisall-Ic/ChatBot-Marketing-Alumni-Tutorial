import mongoose from 'mongoose';

const knowledgeBaseSchema = new mongoose.Schema(
  {
    category: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true, trim: true },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    collection: 'knowledge_base',
    versionKey: false,
  }
);

knowledgeBaseSchema.pre('save', function updateTimestamp(next) {
  this.updatedAt = new Date();
  next();
});

const KnowledgeBase =
  mongoose.models.KnowledgeBase ||
  mongoose.model('KnowledgeBase', knowledgeBaseSchema);
export default KnowledgeBase;
