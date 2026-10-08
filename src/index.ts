// Tasvix core diagram: DSL parsing, execution runtime, and React rendering.

// ── DSL core ───────────────────────────────────────────────────────
export { parse } from './core/parser'
export type {
  FlowEdge,
  FlowGraph,
  FlowGroup,
  FlowNode,
  FlowVar,
  NodeType,
  ParseError,
  ParseResult,
  SelectedElement,
} from './core/types'

export { executeAction, evaluateExpr, initStore, interpolate, parseValue } from './core/evaluate'
export type { VarStore } from './core/evaluate'

// ── Diagram ────────────────────────────────────────────────────────
export { default as FlowDiagram } from './diagram/FlowDiagram'
export type { CameraMode, FlowDiagramHandle, GroupView } from './diagram/FlowDiagram'
export { computeLayout } from './diagram/layout'
export type { FlowDirection } from './diagram/layout'
export type { DiagramStyle, EdgeShape, FlowColors } from './diagram/styles'
export { colorVars } from './diagram/styles'
export { buildEdgePath, curveToPath, pointsToPath, straightToPath } from './diagram/edgePath'
export { getBackgroundConfig, getEdgeStyleOverrides, getNodeStyleOverrides } from './diagram/styles'
export { ICON_MAP } from './diagram/nodes'

// ── Runtime ────────────────────────────────────────────────────────
export { useFlowRuntime, interpolateGraph } from './runtime/useFlowRuntime'
export type { FlowRuntime, FlowRuntimeOptions, RunMode } from './runtime/useFlowRuntime'

// ── Component ──────────────────────────────────────────────────────
export { default as TasvixFlow } from './TasvixFlow'
export type { TasvixFlowHandle, TasvixFlowProps } from './TasvixFlow'
