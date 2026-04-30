import type { ServerResponse } from "node:http";

const jsonHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-origin": "*",
  "content-type": "application/json; charset=utf-8"
};

export function jsonResponse(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, jsonHeaders);
  res.end(JSON.stringify(data, null, 2));
}

export function preflightResponse(res: ServerResponse): void {
  res.writeHead(204, jsonHeaders);
  res.end();
}

export function notFoundResponse(res: ServerResponse): void {
  jsonResponse(res, 404, { error: "not_found" });
}

export function badRequestResponse(res: ServerResponse, message: string): void {
  jsonResponse(res, 400, { error: "bad_request", message });
}
