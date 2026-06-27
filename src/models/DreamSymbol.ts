import mongoose, { Document, Schema } from 'mongoose';

export interface IDreamSymbol extends Document {
  symbol: string;
  interpretation: string;
  category: string;
  symbolValence: number;
  embedding: number[];
  createdAt?: Date;
  updatedAt?: Date;
}

const DreamSymbolSchema = new Schema<IDreamSymbol>(
  {
    symbol: { type: String, required: true, index: true },
    interpretation: { type: String, required: true },
    category: { type: String, required: true },
    symbolValence: { type: Number, required: true },
    embedding: { type: [Number], required: true },
  },
  {
    timestamps: true,
    collection: 'dreamsymbols',
  }
);

export default mongoose.model<IDreamSymbol>('DreamSymbol', DreamSymbolSchema);
