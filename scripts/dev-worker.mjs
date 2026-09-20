// Local-only entrypoint for `npm run dev:worker`. Loads .env.local (real
// DB/S3/OpenAI creds) then layers .env.development.local on top (the local
// ElasticMQ queue override) before starting the real worker, so this queue
// never touches production and worker/index.js itself needs no changes.
import { config } from "dotenv";

config({ path: [".env.local", ".env.development.local"], override: true });

await import("../worker/index.js");
