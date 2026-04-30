import { createServer } from "node:http";
import { loadEnv } from "../config/env.js";
import { BadRequestError, NotFoundError } from "./errors.js";
import { badRequestResponse, jsonResponse, notFoundResponse, preflightResponse } from "./middleware/http.js";
import { registerRoutes } from "./routes/index.js";

const env = loadEnv();
const routes = registerRoutes();

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    notFoundResponse(res);
    return;
  }

  if (req.method.toUpperCase() === "OPTIONS") {
    preflightResponse(res);
    return;
  }

  const handler = routes[`${req.method.toUpperCase()} ${req.url.split("?")[0]}`];

  if (!handler) {
    notFoundResponse(res);
    return;
  }

  try {
    const payload = await handler(req);
    jsonResponse(res, 200, payload);
  } catch (error) {
    if (error instanceof BadRequestError) {
      badRequestResponse(res, error.message);
      return;
    }

    if (error instanceof NotFoundError) {
      jsonResponse(res, 404, {
        error: "not_found",
        message: error.message
      });
      return;
    }

    if (error instanceof Error && error.message.startsWith("Missing required query parameter")) {
      badRequestResponse(res, error.message);
      return;
    }

    jsonResponse(res, 500, {
      error: "internal_server_error",
      message: error instanceof Error ? error.message : "Unexpected error"
    });
  }
});

server.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`);
});
