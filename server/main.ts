import { config, assertProductionSafe } from './config.ts';
import { createApp } from './app.ts';
import { integrationStatus } from './routes.ts';

const problems = assertProductionSafe();
if (problems.length) {
  console.error('Refusing to start in live mode:\n- ' + problems.join('\n- '));
  process.exit(1);
}

const { server, ctx, worker } = createApp();
if (config.runWorker) worker.start();

server.listen(config.port, config.host, () => {
  console.log(`Blue Park running in ${config.mode.toUpperCase()} mode at ${config.publicBaseUrl}`);
  for (const [k, v] of Object.entries(integrationStatus(ctx))) console.log(`  ${k.padEnd(14)} ${v}`);
  if (config.mode === 'demo') console.log('  Demo admin: open /admin and use “Enter demo admin”.');
});

const shutdown = () => {
  worker.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
