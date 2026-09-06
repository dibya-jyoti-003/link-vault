import mongoose from 'mongoose';

const FileSchema = new mongoose.Schema(
  {
    originalName: { type: String },
    mimeType: { type: String },
    size: { type: Number },
    // Opaque identifier for the stored object - never a public URL.
    // For the "local" provider this is a random on-disk filename.
    // For the "r2" provider this is the R2/S3 object key.
    objectKey: { type: String },
  },
  { _id: false }
);

const ShareSchema = new mongoose.Schema(
  {
    shortId: { type: String, required: true, unique: true, index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    type: { type: String, enum: ['text', 'file'], required: true },
    text: { type: String },
    file: { type: FileSchema },
    passwordHash: { type: String },
    oneTime: { type: Boolean, default: false },
    // Atomically flipped to true the first time a one-time share is
    // successfully accessed, so concurrent requests can't both "win".
    consumed: { type: Boolean, default: false },
    maxViews: { type: Number },
    views: { type: Number, default: 0 },
    downloadCount: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: true },
    manageToken: { type: String, required: true, select: false },
  },
  { timestamps: true }
);

// Owner dashboard is always sorted newest-first.
ShareSchema.index({ owner: 1, createdAt: -1 });

export default mongoose.model('Share', ShareSchema);
