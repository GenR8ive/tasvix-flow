export type NodeType = 'start' | 'end' | 'decision' | 'process' | 'io'

export interface FlowVar {
  name: string
  initValue: string
  enumValues?: string[]
  label?: string
}

export interface FlowNode {
  id: string
  type: NodeType
  label: string
  props: Record<string, string>
}

export interface FlowEdge {
  from: string
  to: string
  condition?: boolean | string
}

export interface FlowGroup {
  id: string
  label: string
  props: Record<string, string>
}

export interface FlowGraph {
  nodes: Record<string, FlowNode>
  edges: FlowEdge[]
  vars: FlowVar[]
  groups: FlowGroup[]
}

export interface ParseError {
  line: number
  message: string
}

export type SelectedElement =
  | { kind: 'node'; id: string }
  | { kind: 'var'; name: string }
  | { kind: 'group'; id: string }
  | null

export type ParseResult =
  | { ok: true; graph: FlowGraph }
  | { ok: false; errors: ParseError[] }
