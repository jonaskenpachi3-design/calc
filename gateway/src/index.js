import { loadConfig } from './config.js';
import { abrirBanco } from './db.js';
import { criarApp } from './app.js';

const config = loadConfig();
const db = abrirBanco(config.dbPath);
const server = criarApp(config, db);

server.listen(config.port, () => {
  console.log(JSON.stringify({ nivel: 'info', evento: 'gateway_iniciado', porta: config.port }));
});

const encerrar = () => {
  // Espera as requisições em andamento terminarem; conexões ociosas fecham já. Depois de 15 s, sai de qualquer jeito.
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeIdleConnections?.();
  setTimeout(() => process.exit(1), 15000).unref();
};
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);
