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
  const sqlFragments = Object.create(null);
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

export function collapseWhitespace(sql) {
  let out = "";
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (!inStr && /\s/.test(ch)) {
      if (!out.endsWith(" ")) out += " ";
    } else {
      out += ch;
    }
  }
  return out.trim();
}

function emit(node, parts) {
  if (node.kind === "text") {
    parts.push(node.text.replace(/#\{[^}]*\}/g, "?")); // ${...} 不动
    return;
  }
  if (node.name === "include") {
    parts.push(` ${serializeXmlNode(node)} `);
    return;
  }
  parts.push(` <${node.name}> `);
  for (const child of node.children) emit(child, parts);
  parts.push(` </${node.name}> `);
}

function escapeXmlAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function serializeXmlNode(node) {
  if (node.kind === "text") return node.text;
  const attrs = Object.entries(node.attributes || {})
    .map(([name, value]) => ` ${name}="${escapeXmlAttribute(value)}"`)
    .join("");
  if (!node.children || node.children.length === 0) return `<${node.name}${attrs}/>`;
  return `<${node.name}${attrs}>${node.children.map(serializeXmlNode).join("")}</${node.name}>`;
}

export function normalizeXmlSql(statementNode) {
  const parts = [];
  for (const child of statementNode.children) emit(child, parts);
  return collapseWhitespace(parts.join(""));
}

function lookupFragment(fragments, refid, namespace) {
  if (fragments instanceof Map) {
    const key = refid.includes(".") || !namespace ? refid : `${namespace}.${refid}`;
    const value = fragments.get(key);
    if (!value) return null;
    if (value.node) return { key, node: value.node, namespace: value.namespace || namespace };
    return { key, node: value, namespace };
  }
  if (!Object.prototype.hasOwnProperty.call(fragments, refid)) return null;
  return { key: refid, node: fragments[refid], namespace };
}

export function resolveIncludes(node, sqlFragments, seen = new Set(), namespace = "") {
  if (node.kind !== "element") return node;
  const newChildren = [];
  for (const child of node.children) {
    if (child.kind === "element" && child.name === "include") {
      const refid = child.attributes.refid;
      const fragment = refid ? lookupFragment(sqlFragments, refid, namespace) : null;
      if (fragment && !seen.has(fragment.key)) {
        const nextSeen = new Set(seen).add(fragment.key);
        const expanded = resolveIncludes(fragment.node, sqlFragments, nextSeen, fragment.namespace);
        newChildren.push(...expanded.children);
      } else {
        newChildren.push(child);
      }
    } else {
      newChildren.push(resolveIncludes(child, sqlFragments, seen, namespace));
    }
  }
  return { ...node, children: newChildren };
}
