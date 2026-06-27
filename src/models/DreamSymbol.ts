import mongoose, { Document, Schema } from 'mongoose';

export interface IDreamSymbol extends Document {
  symbol: string;
  category: string;
  symbolValence: number;
  embedding: number[];
  variants: string[];
  canonicalSymbol: string;
  interpretation: string;
}

const DreamSymbolSchema = new Schema<IDreamSymbol>(
  {
    symbol: { type: String, required: true, index: true },
    category: { type: String, required: true },
    symbolValence: { type: Number, required: true },
    embedding: { type: [Number], required: true },
    variants: { type: [String], default: [] },
    canonicalSymbol: { type: String, required: true },
    interpretation: { type: String, required: true },
  },
  {
    timestamps: false,
    collection: 'dreamsymbols',
  }
);

export default mongoose.model<IDreamSymbol>('DreamSymbol', DreamSymbolSchema);
