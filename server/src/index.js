import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config, assertServerConfig } from './config.js';
import { analyzeRouter } from './routes/analyze.js';
import { streamRouter } from './routes/stream.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

assertServerConfig();

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
if (!config.isProd) app.use(morgan('dev'));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'vibrationcheck-server',
    visionProvider: config.visionProvider,
    diagnosticProvider: config.diagnosticProvider,
    verificationModel: config.visionProvider === 'glm-mcp' ? 'glm-4.6v (MCP)' : config.geminiVerificationModel,
    diagnosticModel:
      config.diagnosticProvider === 'glm' ? config.glmModel : config.geminiDiagnosticModel,
    geminiConfigured: Boolean(config.geminiApiKey),
    glmConfigured: Boolean(config.glmApiKey),
    groqConfigured: Boolean(config.groqApiKey),
  });
});

app.use('/api', analyzeRouter);
app.use('/api', streamRouter);

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`\n  ⚙️  VibrationCheck API listening on http://localhost:${config.port}`);
  console.log(`     Vision provider     : ${config.visionProvider}`);
  console.log(`     Diagnostic provider : ${config.diagnosticProvider}`);
  console.log(`     Gemini configured    : ${config.geminiApiKey ? 'yes' : 'no'}`);
  console.log(`     GLM configured       : ${config.glmApiKey ? 'yes' : 'no'}`);
  console.log(`     Groq configured      : ${config.groqApiKey ? 'yes' : 'no'}\n`);
});

// Graceful shutdown — close the MCP child process if it was spawned.
process.on('SIGTERM', async () => {
  const { closeMcpVision } = await import('./services/glm-mcp.js');
  await closeMcpVision();
  process.exit(0);
});
process.on('SIGINT', async () => {
  const { closeMcpVision } = await import('./services/glm-mcp.js');
  await closeMcpVision();
  process.exit(0);
});
