import type { FlowVar } from './types'

export type VarStore = Record<string, number | string | boolean>

// ── Tokenizer ──────────────────────────────────────────────────────

type TokenKind =
  | 'num' | 'str' | 'bool' | 'ident'
  | '+' | '-' | '*' | '/' | '%'
  | '<' | '>' | '<=' | '>=' | '==' | '!='
  | '=' | '+=' | '-='
  | '++' | '--'
  | '(' | ')'
  | 'eof'

interface Token { kind: TokenKind; value: string }

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }

    // two-char operators
    const two = src.slice(i, i + 2)
    if (two === '++' || two === '--' || two === '+=' || two === '-=' || two === '<=' || two === '>=' || two === '==' || two === '!=') {
      tokens.push({ kind: two as TokenKind, value: two })
      i += 2
      continue
    }

    // single-char operators
    if ('+-*/%<>='.includes(ch)) {
      tokens.push({ kind: ch as TokenKind, value: ch })
      i++
      continue
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ kind: ch as TokenKind, value: ch })
      i++
      continue
    }

    // number
    if (/\d/.test(ch) || (ch === '.' && i + 1 < src.length && /\d/.test(src[i + 1]))) {
      let num = ''
      while (i < src.length && /[\d.]/.test(src[i])) num += src[i++]
      tokens.push({ kind: 'num', value: num })
      continue
    }

    // string literal
    if (ch === '"' || ch === "'") {
      const q = ch
      let s = ''
      i++ // skip opening quote
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\' && i + 1 < src.length) { s += src[i + 1]; i += 2 }
        else { s += src[i]; i++ }
      }
      i++ // skip closing quote
      tokens.push({ kind: 'str', value: s })
      continue
    }

    // identifier / boolean
    if (/[a-zA-Z_]/.test(ch)) {
      let id = ''
      while (i < src.length && /\w/.test(src[i])) id += src[i++]
      if (id === 'true' || id === 'false') {
        tokens.push({ kind: 'bool', value: id })
      } else {
        tokens.push({ kind: 'ident', value: id })
      }
      continue
    }

    // skip unknown
    i++
  }
  tokens.push({ kind: 'eof', value: '' })
  return tokens
}

// ── Parser / Evaluator ────────────────────────────────────────────

class Evaluator {
  private pos = 0
  private tokens: Token[]
  private store: VarStore

  constructor(tokens: Token[], store: VarStore) {
    this.tokens = tokens
    this.store = store
  }

  private peek(): Token { return this.tokens[this.pos] ?? { kind: 'eof', value: '' } }
  private advance(): Token { return this.tokens[this.pos++] }

  // Top-level: assignment or expression
  parseStatement(): VarStore {
    const t = this.peek()

    // ident followed by assignment op
    if (t.kind === 'ident') {
      const next = this.tokens[this.pos + 1]
      if (next && (next.kind === '=' || next.kind === '+=' || next.kind === '-=')) {
        return this.parseAssignment()
      }
      // postfix ++ or --
      if (next && (next.kind === '++' || next.kind === '--')) {
        const name = this.advance().value
        const op = this.advance().kind
        const cur = this.toNum(this.store[name] ?? 0)
        this.store[name] = op === '++' ? cur + 1 : cur - 1
        return this.store
      }
    }

    // expression statement — evaluate and discard
    this.parseExpression()
    return this.store
  }

  private parseAssignment(): VarStore {
    const name = this.advance().value
    const op = this.advance().kind

    if (op === '=') {
      this.store[name] = this.parseExpression()
    } else if (op === '+=') {
      const cur = this.toNum(this.store[name] ?? 0)
      this.store[name] = cur + this.toNum(this.parseExpression())
    } else if (op === '-=') {
      const cur = this.toNum(this.store[name] ?? 0)
      this.store[name] = cur - this.toNum(this.parseExpression())
    }
    return this.store
  }

  // expression: comparison
  parseExpression(): number | string | boolean {
    let left = this.parseAddSub()

    while (true) {
      const op = this.peek().kind
      if (op === '<' || op === '>' || op === '<=' || op === '>=' || op === '==' || op === '!=' || op === '=') {
        this.advance()
        const right = this.parseAddSub()
        left = this.compare(left, right, op === '=' ? '==' : op)
      } else break
    }

    return left
  }

  // add / sub
  private parseAddSub(): number | string | boolean {
    let left = this.parseMulDiv()
    while (true) {
      const op = this.peek().kind
      if (op === '+') {
        this.advance()
        const right = this.parseMulDiv()
        // string concat if either side is string
        if (typeof left === 'string' || typeof right === 'string') {
          left = String(left) + String(right)
        } else {
          left = this.toNum(left) + this.toNum(right)
        }
      } else if (op === '-') {
        this.advance()
        left = this.toNum(left) - this.toNum(this.parseMulDiv())
      } else break
    }
    return left
  }

  // mul / div / mod
  private parseMulDiv(): number | string | boolean {
    let left = this.parseUnary()
    while (true) {
      const op = this.peek().kind
      if (op === '*') { this.advance(); left = this.toNum(left) * this.toNum(this.parseUnary()) }
      else if (op === '/') { this.advance(); const r = this.toNum(this.parseUnary()); left = r !== 0 ? this.toNum(left) / r : 0 }
      else if (op === '%') { this.advance(); const r = this.toNum(this.parseUnary()); left = r !== 0 ? this.toNum(left) % r : 0 }
      else break
    }
    return left
  }

  // unary -, prefix ++/--
  private parseUnary(): number | string | boolean {
    const op = this.peek().kind
    if (op === '-') { this.advance(); return -this.toNum(this.parsePrimary()) }

    if (op === '++' || op === '--') {
      this.advance()
      const name = this.advance().value
      const cur = this.toNum(this.store[name] ?? 0)
      this.store[name] = op === '++' ? cur + 1 : cur - 1
      return this.store[name] as number
    }

    return this.parsePrimary()
  }

  // primary: number, string, bool, variable, or parenthesized expression
  private parsePrimary(): number | string | boolean {
    const t = this.advance()
    switch (t.kind) {
      case 'num': return parseFloat(t.value)
      case 'str': return t.value
      case 'bool': return t.value === 'true'
      case 'ident': return this.store[t.value] ?? 0
      case '(': {
        const val = this.parseExpression()
        if (this.peek().kind === ')') this.advance()
        return val
      }
      default: return 0
    }
  }

  private compare(a: number | string | boolean, b: number | string | boolean, op: string): boolean {
    const na = typeof a === 'number' && typeof b === 'number'
    switch (op) {
      case '<': return na ? a < b : this.toNum(a) < this.toNum(b)
      case '>': return na ? a > b : this.toNum(a) > this.toNum(b)
      case '<=': return na ? a <= b : this.toNum(a) <= this.toNum(b)
      case '>=': return na ? a >= b : this.toNum(a) >= this.toNum(b)
      case '==': return a === b
      case '!=': return a !== b
      default: return false
    }
  }

  private toNum(v: number | string | boolean): number {
    if (typeof v === 'number') return v
    if (typeof v === 'boolean') return v ? 1 : 0
    const n = Number(v)
    return Number.isNaN(n) ? 0 : n
  }
}

// ── Public API ─────────────────────────────────────────────────────

export function parseValue(val: string): number | string | boolean {
  if (val === 'true') return true
  if (val === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(val)) return parseFloat(val)
  if (/^["'].*["']$/.test(val)) return val.slice(1, -1)
  return val
}

export function initStore(vars: FlowVar[]): VarStore {
  const store: VarStore = {}
  for (const v of vars) {
    store[v.name] = parseValue(v.enumValues ? v.enumValues[0] : v.initValue.trim())
  }
  return store
}

export function evaluateExpr(expr: string, store: VarStore): number | string | boolean {
  const tokens = tokenize(expr.trim())
  const ev = new Evaluator(tokens, { ...store })
  const result = ev.parseExpression()
  return result
}

export function executeAction(action: string, store: VarStore): VarStore {
  const statements = action.split(';').map(s => s.trim()).filter(Boolean)
  let s = { ...store }
  for (const stmt of statements) {
    const tokens = tokenize(stmt)
    const ev = new Evaluator(tokens, s)
    s = ev.parseStatement()
  }
  return s
}

export function interpolate(tmpl: string, store: VarStore): string {
  return tmpl
    .replace(/<<([^>]+)>>/g, (_m, expr: string) => String(evaluateExpr(expr, store)))
    .replace(/\$\{([^}]+)\}/g, (_m, expr: string) => String(evaluateExpr(expr, store)))
}
