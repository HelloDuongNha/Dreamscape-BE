import './config/env';
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';

import swaggerSpec from './config/swagger';
import {
  apiDocsEnabled,
  buildCorsOptions,
  configureTrustedProxy,
  rateLimitPolicies,
  requestLimits,
} from './config/security';
import indexRouter from './routes/index';
import errorHandler from './middleware/errorHandler';
import requestLogger from './middleware/requestLogger';
import requestShapeGuard from './middleware/requestShapeGuard';
import { createRateLimitMiddleware } from './middleware/rateLimitMiddleware';

const app: Application = express();
const aiRateLimit = createRateLimitMiddleware(rateLimitPolicies.ai);
const oracleRateLimit = createRateLimitMiddleware(rateLimitPolicies.oracle);
const uploadRateLimit = createRateLimitMiddleware(rateLimitPolicies.upload);

configureTrustedProxy(app);
app.disable('x-powered-by');

// Apply transport and browser-facing controls before every HTTP response.
app.use(cors(buildCorsOptions()));
app.use(
  helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production'
      ? {
          directives: {
            defaultSrc: ["'none'"],
            baseUri: ["'none'"],
            frameAncestors: ["'none'"],
            formAction: ["'none'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
  }),
);

// Parse bounded request bodies before validating their object shape.
app.use(
  express.json({
    limit: requestLimits.json,
    verify: (req, _res, buf) => {
      req.rawBodyLength = buf.length;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: requestLimits.urlEncoded }));
app.use(requestLogger);
app.use(requestShapeGuard);

// The broad policy protects API capacity; sensitive paths add tighter limits.
app.use('/api', createRateLimitMiddleware(rateLimitPolicies.global));
app.use('/api/auth/login', createRateLimitMiddleware(rateLimitPolicies.login));
app.use('/api/auth/google', createRateLimitMiddleware(rateLimitPolicies.googleAuth));
app.use('/api/auth/register', createRateLimitMiddleware(rateLimitPolicies.register));
app.use('/api/auth/verify-otp', createRateLimitMiddleware(rateLimitPolicies.otp));
app.use('/api/auth/resend-otp', createRateLimitMiddleware(rateLimitPolicies.otp));
app.use('/api/auth/forgot-password', createRateLimitMiddleware(rateLimitPolicies.recovery));
app.use('/api/auth/reset-password', createRateLimitMiddleware(rateLimitPolicies.recovery));
app.post('/api/dreams/analyze', aiRateLimit);
app.post('/api/dreams/:id/analyze', aiRateLimit);
app.post('/api/dreams/:id/continuation/regenerate', aiRateLimit);
app.post('/api/oracle/threads/:id/turns', oracleRateLimit);
app.post('/api/oracle/threads/:id/turns/:turnId/branch', oracleRateLimit);
app.post('/api/sources/contribute-pdf', uploadRateLimit);
app.post('/api/sources/approved/:id/upload-pdf', uploadRateLimit);
app.post('/api/moderation/sources/upload-pdf', uploadRateLimit);

// Keep interactive API documentation out of production unless explicitly enabled.
if (apiDocsEnabled()) {
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'DreamScape API Docs',
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerOptions: { persistAuthorization: process.env.NODE_ENV !== 'production' },
    }),
  );
}

app.use('/api', indexRouter);

// The global error handler must remain last.
app.use(errorHandler);

export default app;
