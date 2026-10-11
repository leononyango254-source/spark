import { loadEnv } from "./env";
import { buildServer } from "./server";

const env = loadEnv();
const app = buildServer();

app
  .listen({ port: env.API_PORT, host: env.API_HOST })
  .then((address) => {
    app.log.info(`spark-api listening on ${address}`);
  })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
