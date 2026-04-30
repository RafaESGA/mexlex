import test from "node:test";
import assert from "node:assert/strict";
import {
  extractAuthorsFromDatosAbiertos,
  extractWordText,
  parseSenadoDatosAbiertosJsonArray
} from "../ingestion/adapters/senado-datos-abiertos-local/index.js";

test("extracts multiple authors from senadores field and strips party suffixes", () => {
  const authors = extractAuthorsFromDatosAbiertos(
    "Ana Karen Hernández Aceves (PT)<br>Lizeth Sánchez García (PT)<br>Alberto Anaya Gutiérrez (PT)<br>"
  );

  assert.deepEqual(authors.map((author) => author.fullName), [
    "Ana Karen Hernández Aceves",
    "Lizeth Sánchez García",
    "Alberto Anaya Gutiérrez"
  ]);
});

test("dedupes repeated authors and removes senator prefixes", () => {
  const authors = extractAuthorsFromDatosAbiertos(
    "senadores Cristina Ruíz Sandoval (PRI)<br>Cristina Ruíz Sandoval (PRI)<br>"
  );

  assert.deepEqual(authors.map((author) => author.fullName), ["Cristina Ruíz Sandoval"]);
});

test("reconstructs word text by concatenating split w:t nodes", () => {
  const xml =
    '<w:body><w:p><w:r><w:t>[{"titulo":"Proyecto de </w:t></w:r><w:r><w:t>decreto","tipo":"iniciativa"}]</w:t></w:r></w:p></w:body>';

  assert.equal(extractWordText(xml), '[{"titulo":"Proyecto de decreto","tipo":"iniciativa"}]');
});

test("parses only iniciativa rows from reconstructed json text", () => {
  const rows = parseSenadoDatosAbiertosJsonArray(
    '[{"id":"1","titulo":"A","tipo":"iniciativa"},{"id":"2","titulo":"B","tipo":"proposición"}]',
    "inline"
  );

  assert.deepEqual(rows.map((row) => row.id), ["1"]);
});
