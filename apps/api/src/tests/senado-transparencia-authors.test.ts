import test from "node:test";
import assert from "node:assert/strict";
import { extractAuthorsFromSenadoTransparenciaProponentes } from "../ingestion/adapters/senado-transparencia/index.js";

test("extracts a single senator cleanly from cargo_proponente", () => {
  const authors = extractAuthorsFromSenadoTransparenciaProponentes("Sen. Juanita Guerra Mena. PVEM");

  assert.deepEqual(authors.map((author) => author.fullName), ["Juanita Guerra Mena"]);
});

test("extracts joint signers introduced by suscrita por", () => {
  const authors = extractAuthorsFromSenadoTransparenciaProponentes(
    "Del Sen. Waldo Fernández González y suscrita por la Sen. Judith Díaz Delgado. PVEM"
  );

  assert.deepEqual(authors.map((author) => author.fullName), ["Waldo Fernández González", "Judith Díaz Delgado"]);
});

test("extracts diputados and removes trailing party suffixes", () => {
  const authors = extractAuthorsFromSenadoTransparenciaProponentes(
    "Dip. Ricardo Crespo Arroyo. MORENA"
  );

  assert.deepEqual(authors.map((author) => author.fullName), ["Ricardo Crespo Arroyo"]);
});

test("extracts multiple signers separated inside the same cargo string", () => {
  const authors = extractAuthorsFromSenadoTransparenciaProponentes(
    "Sen. Alejandro Moreno Cárdenas, Sen. Manuel Añorve Baños y Sen. Cristina Ruíz Sandoval. PRI"
  );

  assert.deepEqual(authors.map((author) => author.fullName), [
    "Alejandro Moreno Cárdenas",
    "Manuel Añorve Baños",
    "Cristina Ruíz Sandoval"
  ]);
});

test("extracts collective PRI signatures without merging the last two names", () => {
  const authors = extractAuthorsFromSenadoTransparenciaProponentes(
    "De las senadoras y senadores Mely Romero Celis, Cristina Ruíz Sandoval, Paloma Sánchez Ramos, Miguel Ángel Riquelme Solís, Anabell Ávalos Zempoalteca, Nestor Camarillo Medina, Claudia Edith Anaya Mota y Manuel Añorve Baños. PRI"
  );

  assert.deepEqual(authors.map((author) => author.fullName), [
    "Mely Romero Celis",
    "Cristina Ruíz Sandoval",
    "Paloma Sánchez Ramos",
    "Miguel Ángel Riquelme Solís",
    "Anabell Ávalos Zempoalteca",
    "Nestor Camarillo Medina",
    "Claudia Edith Anaya Mota",
    "Manuel Añorve Baños"
  ]);
});

test("extracts collective PRI signatures with parliamentary group suffix", () => {
  const authors = extractAuthorsFromSenadoTransparenciaProponentes(
    "De las senadoras y senadores Claudia Edith Anaya Mota, Anabell Ávalos Zempoalteca, Cristina Ruiz Sandoval, Néstor Camarillo Medina, Mely Romero Celis, Miguel Ángel Riquelme Solís, Paloma Sánchez Ramos, Karla Guadalupe Toledo Zamora, Ángel García Yáñez y Manuel Añorve Baños, del Grupo Parlamentario del Partido Revolucionario Institucional. PRI"
  );

  assert.deepEqual(authors.map((author) => author.fullName), [
    "Claudia Edith Anaya Mota",
    "Anabell Ávalos Zempoalteca",
    "Cristina Ruiz Sandoval",
    "Néstor Camarillo Medina",
    "Mely Romero Celis",
    "Miguel Ángel Riquelme Solís",
    "Paloma Sánchez Ramos",
    "Karla Guadalupe Toledo Zamora",
    "Ángel García Yáñez",
    "Manuel Añorve Baños"
  ]);
});
