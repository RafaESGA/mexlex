import test from "node:test";
import assert from "node:assert/strict";
import { parseSenadoGacetaDocumentInitiatives } from "../ingestion/adapters/senado-gaceta/parsers/parse-initiative.js";
import type { SenadoHtmlPage } from "../ingestion/adapters/senado-gaceta/types.js";

test("splits collective Senado signatures into clean individual authors", () => {
  const page: SenadoHtmlPage = {
    url: "https://www.senado.gob.mx/66/gaceta_del_senado/documento/158383",
    fetchedAt: "2026-04-22T00:00:00.000Z",
    contentType: "text/html",
    kind: "document",
    sessionDate: "2026-04-21",
    html: `
      <html>
        <body>
          Martes 21 de abril de 2026 / Gaceta: LXVI/2SPO-303/158383
          INICIATIVAS:
          De las senadoras y de los senadores Alejandro Moreno Cárdenas, Manuel Añorve Baños,
          Alma Carolina Viggiano Austria, Pablo Guillermo Angulo Briceño, Cristina Ruíz Sandoval
          y Anabell Ávalos Zempoalteca, del Grupo Parlamentario del Partido Revolucionario Institucional,
          con proyecto de decreto por el que se modifica la fracción XXIII del artículo 73
          de la Constitución Política de los Estados Unidos Mexicanos.
          DICTÁMENES A DISCUSIÓN Y VOTACIÓN
        </body>
      </html>
    `
  };

  const initiatives = parseSenadoGacetaDocumentInitiatives(page);

  assert.equal(initiatives.length, 1);
  assert.deepEqual(
    initiatives[0]?.authors.map((author) => author.fullName),
    [
      "Alejandro Moreno Cárdenas",
      "Manuel Añorve Baños",
      "Alma Carolina Viggiano Austria",
      "Pablo Guillermo Angulo Briceño",
      "Cristina Ruíz Sandoval",
      "Anabell Ávalos Zempoalteca"
    ]
  );
});

test("keeps single Senado authors clean without parliamentary-group residue", () => {
  const page: SenadoHtmlPage = {
    url: "https://www.senado.gob.mx/66/gaceta_del_senado/documento/158383",
    fetchedAt: "2026-04-22T00:00:00.000Z",
    contentType: "text/html",
    kind: "document",
    sessionDate: "2026-04-21",
    html: `
      <html>
        <body>
          Martes 21 de abril de 2026 / Gaceta: LXVI/2SPO-303/158383
          INICIATIVAS:
          De la Sen. Juanita Guerra Mena, del Grupo Parlamentario de Partido Verde Ecologista de México,
          con proyecto de decreto por el que se reforman y adicionan diversas disposiciones del Código Penal Federal.
          PROPOSICIONES:
        </body>
      </html>
    `
  };

  const initiatives = parseSenadoGacetaDocumentInitiatives(page);

  assert.equal(initiatives.length, 1);
  assert.deepEqual(initiatives[0]?.authors.map((author) => author.fullName), ["Juanita Guerra Mena"]);
});

test("handles PAN-style collective signatures without leaving senadores prefixes behind", () => {
  const page: SenadoHtmlPage = {
    url: "https://www.senado.gob.mx/66/gaceta_del_senado/documento/158383",
    fetchedAt: "2026-04-22T00:00:00.000Z",
    contentType: "text/html",
    kind: "document",
    sessionDate: "2026-04-21",
    html: `
      <html>
        <body>
          Martes 21 de abril de 2026 / Gaceta: LXVI/2SPO-303/158383
          INICIATIVAS:
          De las senadoras y los senadores Ricardo Anaya Cortés, Gina Gerardina Campuzano González,
          Marko Cortés Mendoza, María de Jesús Díaz Marmolejo y Susana Zatarain García,
          del Grupo Parlamentario del Partido Acción Nacional, con proyecto de decreto
          por el que se reforman la fracción IV y el tercer párrafo del artículo 71
          de la Constitución Política de los Estados Unidos Mexicanos.
          AGENDA POLÍTICA
        </body>
      </html>
    `
  };

  const initiatives = parseSenadoGacetaDocumentInitiatives(page);

  assert.equal(initiatives.length, 1);
  assert.deepEqual(
    initiatives[0]?.authors.map((author) => author.fullName),
    [
      "Ricardo Anaya Cortés",
      "Gina Gerardina Campuzano González",
      "Marko Cortés Mendoza",
      "María de Jesús Díaz Marmolejo",
      "Susana Zatarain García"
    ]
  );
});
