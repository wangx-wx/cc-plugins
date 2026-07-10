import { test } from "node:test";
import assert from "node:assert/strict";
import sax from "../lib/sax.js";

test("sax 能解析标签并给出行号", () => {
  const parser = sax.parser(true, { position: true });
  const opened = [];
  parser.onopentag = (node) => opened.push({ name: node.name, line: parser.line });
  parser.write("<a>\n<b/>\n</a>").close();
  assert.deepEqual(opened.map((o) => o.name), ["a", "b"]);
  assert.equal(typeof opened[0].line, "number");
});
