import sax from "../lib/sax.js";

const STATEMENT_TYPES = new Set(["select", "insert", "update", "delete"]);

// 建立字符偏移 -> 1-based 行号 的映射
function buildOffsetToLine(xml) {
  const lineStarts = [0];
  for (let i = 0; i < xml.length; i++) {
    if (xml[i] === "\n") lineStarts.push(i + 1);
  }
  return (offset) => {
    // 二分：最后一个 <= offset 的 lineStart 下标
    let lo = 0, hi = lineStarts.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= offset) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return ans + 1; // 1-based
  };
}

export function parseMapperXml(xml) {
  const parser = sax.parser(true, { position: true, trim: false, normalize: false });
  const offsetToLine = buildOffsetToLine(xml);

  let namespace = "";
  const statements = [];
  const sqlFragments = {};
  const stack = []; // ElementNode 栈
  let currentStartLine = 1;

  parser.onopentag = (tag) => {
    if (tag.name === "mapper") {
      namespace = tag.attributes.namespace || "";
    }
    const node = { kind: "element", name: tag.name, attributes: { ...tag.attributes }, children: [] };
    // startTagPosition 指向 '<' 的偏移（1-based position），转 0-based 再查行
    const startOffset = Math.max(0, (parser.startTagPosition || parser.position) - 1);
    node._startLine = offsetToLine(startOffset);
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    stack.push(node);
  };

  parser.ontext = (t) => {
    if (stack.length > 0) stack[stack.length - 1].children.push({ kind: "text", text: t });
  };
  parser.oncdata = (t) => {
    if (stack.length > 0) stack[stack.length - 1].children.push({ kind: "text", text: t });
  };

  parser.onclosetag = (name) => {
    const node = stack.pop();
    if (!node) return;
    node._endLine = offsetToLine(Math.max(0, parser.position - 1)); // 结束标签所在行
    if (STATEMENT_TYPES.has(name)) {
      statements.push({ type: name, id: node.attributes.id || "", startLine: node._startLine, node });
    } else if (name === "sql" && node.attributes.id) {
      sqlFragments[node.attributes.id] = node;
    }
  };

  parser.write(xml).close();
  return { namespace, statements, sqlFragments };
}
