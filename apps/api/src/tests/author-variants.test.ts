import test from "node:test";
import assert from "node:assert/strict";
import { buildAuthorVariantSuggestions } from "../modules/reconciliation/author-variants.js";

test("prefers the cleanest most-used display name as canonical author", () => {
  const suggestions = buildAuthorVariantSuggestions([
    {
      id: "a1",
      fullName: "Alejandro Gonzalez Yanez",
      nameNormalized: "alejandro gonzalez yanez",
      chamber: "senado",
      initiativeCount: 2
    },
    {
      id: "a2",
      fullName: "Sen. Alejandro González Yáñez",
      nameNormalized: "alejandro gonzalez yanez",
      chamber: "senado",
      initiativeCount: 1
    },
    {
      id: "a3",
      fullName: "Alejandro González Yáñez",
      nameNormalized: "alejandro gonzalez yanez",
      chamber: "senado",
      initiativeCount: 4
    }
  ]);

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0]?.canonicalAuthorId, "a3");
  assert.equal(suggestions[0]?.canonicalFullName, "Alejandro González Yáñez");
  assert.deepEqual(
    suggestions[0]?.aliases.map((alias) => alias.authorId),
    ["a3", "a1", "a2"]
  );
});
