import './config/env';
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';

import swaggerSpec from './config/swagger';
import indexRouter from './routes/index';
import errorHandler from './middleware/errorHandler';
import requestLogger from './middleware/requestLogger';

const app: Application = express();

// ─── Core Middleware (CORS, Body Parsing, Request Logger) ───────────────────────
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}
app.use(requestLogger);

// ─── Swagger Documentation (mounted BEFORE tight security) ─────────────────────
app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'DreamScape API Docs',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: { persistAuthorization: true },
  }),
);

// ─── Security Middleware (Helmet) ─────────────────────────────────────────────
// Disable CSP & Cross‑Origin‑Embedder‑Policy for development so Swagger UI can
// load its inline scripts/styles. In production you would tighten these.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api', indexRouter);

// ─── Global Error Handler (must be last) ─────────────────────────────────────
app.use(errorHandler);

export default app;
