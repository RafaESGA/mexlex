import test from "node:test";
import assert from "node:assert/strict";
import { extractSenateCommissionNames } from "../modules/reconciliation/senate-commissions.js";

test("extracts commission names from datos abiertos style lines", () => {
  const names = extractSenateCommissionNames(
    "Salud (Coordinadora) <br>Estudios Legislativos (Comisiones Unidas) <br>"
  );

  assert.deepEqual(names, ["Salud", "Estudios Legislativos"]);
});

test("extracts united commissions from transparencia style semicolon text", () => {
  const names = extractSenateCommissionNames(
    "Comisiones Unidas de Gobernación; de Derechos Humanos y de Estudios Legislativos, Segunda."
  );

  assert.deepEqual(names, ["Gobernación", "Derechos Humanos", "Estudios Legislativos, Segunda"]);
});

test("keeps Estudios Legislativos, Segunda as a single commission while splitting gender commission", () => {
  const names = extractSenateCommissionNames(
    "Comisiones Unidas de Puntos Constitucionales, Para la Igualdad de Género y de Estudios Legislativos, Segunda."
  );

  assert.deepEqual(names, ["Puntos Constitucionales", "Para la Igualdad de Género", "Estudios Legislativos, Segunda"]);
});

test("ignores chamber references that are not commissions", () => {
  const names = extractSenateCommissionNames("Cámara de Diputados.");

  assert.deepEqual(names, []);
});
