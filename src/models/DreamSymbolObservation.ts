import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IDreamSymbolObservation extends Document {
  dreamId: Types.ObjectId;
  userId: Types.ObjectId;
  symbolKey: string;
  displayLabel: string;
  noteIndex: number;
  contextFingerprint: string;
  contextualTone: 'threatening' | 'reassuring' | 'ambivalent' | 'neutral';
  origin: 'dictionary' | 'contextual_observation';
  dictionarySymbol?: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DreamSymbolObservationSchema = new Schema<IDreamSymbolObservation>({
  dreamId: { type: Schema.Types.ObjectId, ref: 'Dream', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  symbolKey: { type: String, required: true, trim: true },
  displayLabel: { type: String, required: true, trim: true },
  noteIndex: { type: Number, required: true, min: 0 },
  contextFingerprint: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  contextualTone: {
    type: String,
    enum: ['threatening', 'reassuring', 'ambivalent', 'neutral'],
    default: 'neutral',
  },
  origin: {
    type: String,
    enum: ['dictionary', 'contextual_observation'],
    required: true,
  },
  dictionarySymbol: { type: String, trim: true, default: undefined },
  isPublic: { type: Boolean, required: true, default: false },
}, {
  timestamps: true,
  collection: 'dreamsymbolobservations',
});

DreamSymbolObservationSchema.index({ dreamId: 1, symbolKey: 1 }, { unique: true });
DreamSymbolObservationSchema.index({ symbolKey: 1, isPublic: 1, createdAt: -1 });
DreamSymbolObservationSchema.index({ userId: 1, symbolKey: 1, createdAt: -1 });

export default mongoose.model<IDreamSymbolObservation>('DreamSymbolObservation', DreamSymbolObservationSchema);
