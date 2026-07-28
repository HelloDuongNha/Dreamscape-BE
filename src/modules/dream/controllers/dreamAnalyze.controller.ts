import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import Dream from '../models/Dream';
import { OllamaServiceError } from '../../../infrastructure/llm.service';
import { logger } from '../../../infrastructure/logger';
import { runDreamAnalysis } from '../services/analysis/orchestration/analyze.service';
import { mapDreamResponse } from '../services/content/dreamNarrative.service';
import { syncDreamSymbolObservations } from '../services/analysis/execution/dreamSymbolObservationSync.service';
import { syncDreamEvidenceNeeds } from '../services/analysis/execution/dreamEvidenceSync.service';
import { parseAnalyzeDreamRequest } from '../dto/dreamAnalyze.dto';

// Runs the synchronous analysis endpoint and saves only a validated result.
export async function analyzeDream(req: Request, res: Response): Promise<void> {
  try {
    const parsed = parseAnalyzeDreamRequest(req.body);
    if (!parsed.ok) {
      res.status(parsed.status).json({ success: false, message: parsed.message });
      return;
    }
    const { dreamText, sleepContext, visibility: targetVisibility } = parsed.value;
    const userId = String(req.user!._id);

    logger.info('Starting dream analysis pipeline', { userId, visibility: targetVisibility });
    const { aiAnalysis, retrievedContext, strategyUsed, analysisEmbedding } = await runDreamAnalysis(
      userId,
      dreamText,
      sleepContext || {},
    );
    const savedDream = new Dream({
      userId: new Types.ObjectId(userId),
      content: dreamText.trim(),
      mood_tag: aiAnalysis.emotional_tone || '',
      is_public: targetVisibility === 'public',
      privacy: targetVisibility,
      ai_status: 'completed',
      ai_result: aiAnalysis,
      analysisEmbedding,
      sleepContext,
      retrievedContext,
      analysisMetadata: {
        strategyUsed,
        llmModel: process.env.OLLAMA_MODEL || 'qwen2.5:14b',
        embeddingModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
        ragTopK: retrievedContext.componentA.usedSymbols.length,
        minSimilarityScore: parseFloat(process.env.SYMBOL_RAG_MIN_SCORE || '0.55'),
        vectorBackend: retrievedContext.componentA.retrievalConfig.vectorBackend,
        analysisVersion: '2.0.0-grounded',
        generatedAt: new Date(),
      },
    });

    await savedDream.save();
    await syncDreamSymbolObservations(savedDream);
    await syncDreamEvidenceNeeds(savedDream);
    logger.info('Dream analysis pipeline completed and saved successfully', {
      dreamId: String(savedDream._id),
      userId,
      rulesCount: retrievedContext.componentD.appliedRules.length,
      symbolsCount: retrievedContext.componentA.usedSymbols.length,
      strategyUsed,
      modelUsed: process.env.OLLAMA_MODEL || 'qwen2.5:14b',
      validationStatus: 'passed',
    });

    const responseData = mapDreamResponse(savedDream);
    res.status(201).json({
      success: true,
      message: 'Dream analyzed and saved successfully.',
      data: responseData,
    });
  } catch (error: any) {
    if (error instanceof OllamaServiceError) {
      logger.error('Ollama Service Error encountered in analysis controller', {
        statusCode: error.statusCode,
        message: error.message,
      });
      res.status(error.statusCode).json({ success: false, message: error.message });
      return;
    }
    logger.error('Unexpected error encountered in dream analysis controller', error);
    res.status(500).json({
      success: false,
      message: 'An unexpected internal error occurred during dream analysis.',
      error: error.message,
    });
  }
}
