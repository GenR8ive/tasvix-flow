import type { NodeType, FlowNode, FlowEdge, FlowVar, FlowGroup, ParseError, ParseResult } from './types'

type NodeMap = Record<string, FlowNode>

const VALID_TYPES: ReadonlySet<string> = new Set<NodeType>(['start', 'end', 'decision', 'process', 'io'])

interface NodeExpr {
  type: NodeType | null
  id: string
  condition?: boolean | string
  props: Record<string, string>
}

function parseProps(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  const props: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const trimmed = pair.trim()
    if (!trimmed) continue
    // Try quoted value: key:"value"
    const quoted = trimmed.match(/^(\w+)\s*:\s*"([^"]*)"$/)
    if (quoted) { props[quoted[1]] = quoted[2]; continue }
    // Try unquoted value: key:value
    const unquoted = trimmed.match(/^(\w+)\s*:\s*(.+)$/)
    if (unquoted) props[unquoted[1]] = unquoted[2].trim()
  }
  return props
}

function splitArrowSegments(line: string): string[] | null {
  const segments: string[] = []
  let depth = 0
  let inQuotes = false
  let start = 0

  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i]
    if (ch === '"') inQuotes = !inQuotes
    if (!inQuotes) {
      if (ch === '{') depth++
      if (ch === '}') depth--
      if (depth === 0 && ch === '-' && line[i + 1] === '>') {
        const seg = line.slice(start, i).trim()
        if (seg === '') return null
        segments.push(seg)
        start = i + 2
        i++ // skip '>'
      }
    }
  }

  const last = line.slice(start).trim()
  if (last === '') return null
  segments.push(last)
  return segments
}

/** First `{` outside of double quotes. */
function scanFirstOpenBrace(s: string): number {
  let inQuotes = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '"') { inQuotes = !inQuotes; continue }
    if (!inQuotes && ch === '{') return i
  }
  return -1
}

/** Matching `}` for `s[open]`, ignoring braces inside double quotes. -1 if unbalanced. */
function findCloseBrace(s: string, open: number): number {
  let depth = 0
  let inQuotes = false
  for (let i = open; i < s.length; i++) {
    const ch = s[i]
    if (ch === '"') { inQuotes = !inQuotes; continue }
    if (inQuotes) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Split `head{props}` — props may contain nested braces (e.g. `${expr}` labels). */
function splitHeadProps(seg: string): { head: string; props?: string } | null {
  const open = scanFirstOpenBrace(seg)
  if (open === -1) return { head: seg }
  const close = findCloseBrace(seg, open)
  if (close !== seg.length - 1) return null
  return { head: seg.slice(0, open), props: seg.slice(open + 1, close) }
}

/** `var:name{props}=value` declaration. */
function parseVarLine(line: string): { name: string; props?: string; value: string } | null {
  if (!line.startsWith('var:')) return null
  let i = 4
  while (i < line.length && /\w/.test(line[i])) i++
  const name = line.slice(4, i)
  if (name === '') return null
  let props: string | undefined
  if (line[i] === '{') {
    const close = findCloseBrace(line, i)
    if (close === -1) return null
    props = line.slice(i + 1, close)
    i = close + 1
  }
  const eq = /^\s*=/.exec(line.slice(i))
  if (!eq) return null
  const value = line.slice(i + eq[0].length).trim()
  return value === '' ? null : { name, props, value }
}

function parseNodeExpr(seg: string): NodeExpr | null {
  const parts = splitHeadProps(seg)
  if (!parts) return null
  const head = parts.head.trim()

  // Reserved IDs: start, end
  if (head === 'start' || head === 'end') {
    return { type: head, id: head, props: parseProps(parts.props) }
  }

  // Conditional ref: [type:]id(condition)
  const cond = head.match(/^(?:(\w+):)?(\w+)\(([^)]+)\)$/)
  if (cond) {
    const typePrefix = cond[1]
    const id = cond[2]
    const rawCond = cond[3].trim()
    const condition = rawCond === 'true' ? true : rawCond === 'false' ? false : /^["'].*["']$/.test(rawCond) ? rawCond.slice(1, -1) : rawCond
    return { type: typePrefix ? (typePrefix as NodeType) : null, id, condition, props: parseProps(parts.props) }
  }

  // Plain ref: [type:]id
  const plain = head.match(/^(?:(\w+):)?(\w+)$/)
  if (plain) {
    return { type: plain[1] ? (plain[1] as NodeType) : null, id: plain[2], props: parseProps(parts.props) }
  }

  return null
}

function resolveType(expr: NodeExpr): { type: NodeType; explicit: boolean } {
  if (expr.id === 'start') return { type: 'start', explicit: true }
  if (expr.id === 'end') return { type: 'end', explicit: true }
  if (expr.type !== null) return { type: expr.type, explicit: true }
  return { type: 'process', explicit: false }
}

function registerNode(
  nodes: NodeMap,
  explicitTypes: Map<string, NodeType>,
  explicitSet: Set<string>,
  expr: NodeExpr,
  errors: ParseError[],
  lineNum: number,
): boolean {
  const { type: effectiveType, explicit: isNewExplicit } = resolveType(expr)

  // Validate type prefix is a known NodeType (only if explicitly provided)
  if (expr.type !== null && !VALID_TYPES.has(expr.type)) {
    errors.push({ line: lineNum, message: `Invalid node type: '${expr.type}'` })
    return false
  }

  const existing = explicitTypes.get(expr.id)

  if (existing !== undefined) {
    const wasExplicit = explicitSet.has(expr.id)

    if (isNewExplicit && wasExplicit && existing !== effectiveType) {
      errors.push({
        line: lineNum,
        message: `Type conflict for '${expr.id}': previously '${existing}', now '${effectiveType}'`,
      })
      return false
    }

    if (isNewExplicit && !wasExplicit) {
      // Upgrade: implicit -> explicit
      explicitTypes.set(expr.id, effectiveType)
      explicitSet.add(expr.id)
    }

    // Merge props (last write wins per key)
    const node = nodes[expr.id]
    node.props = { ...node.props, ...expr.props }
    node.label = node.props.label ?? node.id
    if (isNewExplicit) {
      node.type = effectiveType
    }
  } else {
    // First time seeing this id
    explicitTypes.set(expr.id, effectiveType)
    if (isNewExplicit) explicitSet.add(expr.id)

    nodes[expr.id] = {
      id: expr.id,
      type: effectiveType,
      label: expr.props.label ?? expr.id,
      props: { ...expr.props },
    }
  }

  return true
}

export function parse(text: string): ParseResult {
  const nodes: NodeMap = {}
  const edges: FlowEdge[] = []
  const vars: FlowVar[] = []
  const groups: FlowGroup[] = []
  const errors: ParseError[] = []
  const explicitTypes = new Map<string, NodeType>()
  const explicitSet = new Set<string>()
  const groupIds = new Set<string>()

  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') continue

    const lineNum = i + 1

    // var declaration
    const varDecl = parseVarLine(line)
    if (varDecl) {
      const props = parseProps(varDecl.props)
      const parts = varDecl.value.split('|').map(s => s.trim())
      if (parts.length > 1) {
        const enumValues = parts.map(p => /^["'].*["']$/.test(p) ? p.slice(1, -1) : p)
        vars.push({ name: varDecl.name, initValue: enumValues[0], enumValues, label: props.label })
      } else {
        vars.push({ name: varDecl.name, initValue: varDecl.value, label: props.label })
      }
      continue
    }

    // group declaration
    if (line.startsWith('group:')) {
      const groupParts = splitHeadProps(line.slice(6))
      if (groupParts && /^\w+$/.test(groupParts.head)) {
        const id = groupParts.head
        const props = parseProps(groupParts.props)
        groups.push({ id, label: props.label ?? id, props })
        groupIds.add(id)
        continue
      }
    }

    const segments = splitArrowSegments(line)

    if (segments === null) {
      errors.push({ line: lineNum, message: `Missing target after '->'` })
      continue
    }

    // Parse all segments
    const exprs: NodeExpr[] = []
    let failed = false

    for (const seg of segments) {
      const expr = parseNodeExpr(seg)
      if (!expr) {
        errors.push({ line: lineNum, message: `Invalid node expression: "${seg}"` })
        failed = true
        break
      }
      exprs.push(expr)
    }

    if (failed) continue

    // Validate: conditions only on first segment
    for (let j = 1; j < exprs.length; j++) {
      if (exprs[j].condition !== undefined) {
        errors.push({ line: lineNum, message: `Conditions are only allowed on the source node` })
        failed = true
        break
      }
    }

    if (failed) continue

    // Register all nodes (skip segments that reference a declared group)
    let registered = true
    for (const expr of exprs) {
      if (groupIds.has(expr.id)) continue
      if (!registerNode(nodes, explicitTypes, explicitSet, expr, errors, lineNum)) {
        registered = false
        break
      }
    }

    if (!registered) continue

    // Create edges between adjacent segments
    for (let j = 0; j < exprs.length - 1; j++) {
      const edge: FlowEdge = { from: exprs[j].id, to: exprs[j + 1].id }
      if (exprs[j].condition !== undefined) {
        edge.condition = exprs[j].condition
      }
      edges.push(edge)
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return { ok: true, graph: { nodes, edges, vars, groups } }
}
