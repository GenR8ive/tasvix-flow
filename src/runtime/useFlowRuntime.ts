import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FlowEdge, FlowGraph, ParseResult } from '../core/types'
import { parse } from '../core/parser'
import { executeAction, initStore, evaluateExpr, interpolate } from '../core/evaluate'
import type { VarStore } from '../core/evaluate'

export type RunMode = 'once' | 'repeat'

export interface FlowRuntimeOptions {
  /** Pre-parsed DSL result. Takes precedence over `dsl`. */
  result?: ParseResult | null
  /** Raw DSL text, parsed internally when `result` is not given. */
  dsl?: string
  /** Seconds between steps while running. */
  speed?: number
  mode?: RunMode
}

export interface FlowRuntime {
  result: ParseResult | null
  /** Graph with `${...}` / `<<...>>` labels interpolated against the variable store. */
  graph: FlowGraph | null
  /** Node id currently highlighted by the simulation. */
  currentStep: string | null
  /** Number of executed steps, used to key step-change animations. */
  stepIndex: number
  visitedNodes: Set<string>
  traversedEdges: Set<string>
  /** Key of the edge traversed by the last step (animates on change). */
  activeEdge: string | null
  /** Key of the edge that will be taken next (preview highlight). */
  nextEdgeId: string | null
  varStore: VarStore
  setVarStore: (updater: VarStore | ((prev: VarStore) => VarStore)) => void
  running: boolean
  speed: number
  mode: RunMode
  setSpeed: (speed: number) => void
  setMode: (mode: RunMode) => void
  canStep: boolean
  step: () => void
  run: () => void
  stop: () => void
  reset: () => void
}

/** Apply `${...}` / `<<...>>` label interpolation against a variable store. */
export function interpolateGraph(graph: FlowGraph, store: VarStore): FlowGraph {
  const hasTemplates = Object.values(graph.nodes).some((n) => /\$\{|<<[^>]+>>/.test(n.label))
  if (!hasTemplates || Object.keys(store).length === 0) return graph

  return {
    ...graph,
    nodes: Object.fromEntries(
      Object.entries(graph.nodes).map(([id, node]) => [
        id,
        {
          ...node,
          label: /\$\{|<<[^>]+>>/.test(node.label) ? interpolate(node.label, store) : node.label,
        },
      ]),
    ),
  }
}

function condMatch(condition: boolean | string | undefined, result: number | string | boolean): boolean {
  if (condition === undefined) return false
  if (condition === result) return true
  return String(condition) === String(result)
}

interface StepResult {
  nextId: string
  visitedId: string
  edgeKey: string
  newStore: VarStore
  nextEdgeId: string | null
}

function pickEdge(graph: FlowGraph, fromId: string, store: VarStore): FlowEdge | null {
  const outEdges = graph.edges.filter((e) => e.from === fromId)
  if (outEdges.length === 0) return null

  const node = graph.nodes[fromId]
  if (node?.type !== 'decision') {
    return outEdges.find((e) => e.condition === true) ?? outEdges[0]
  }

  const conditionExpr = node.props.condition || (fromId in store ? fromId : undefined)
  if (!conditionExpr) return outEdges[0]

  try {
    const result = evaluateExpr(conditionExpr, store)
    return outEdges.find((e) => condMatch(e.condition, result)) ?? outEdges[0]
  } catch {
    return outEdges[0]
  }
}

/** Execute one transition from `currentId`. Returns null when the run is over. */
function advance(graph: FlowGraph, currentId: string | null, currentStore: VarStore): StepResult | null {
  const groupIds = new Set(graph.groups.map((g) => g.id))
  const current = currentId ?? 'start'
  if (current === 'end') return null
  if (!graph.nodes[current]) return null

  let store = { ...currentStore }
  const action = graph.nodes[current].props.action
  if (action) store = executeAction(action, store)

  const nextEdge = pickEdge(graph, current, store)
  if (!nextEdge) return null

  const edgeKey = `${nextEdge.from}->${nextEdge.to}`

  // Resolve group passthrough
  let targetId = nextEdge.to
  const visitedGroups = new Set<string>()
  while (groupIds.has(targetId) && !visitedGroups.has(targetId)) {
    visitedGroups.add(targetId)
    const groupOut = graph.edges.filter((e) => e.from === targetId)
    if (groupOut.length === 0) break
    targetId = groupOut[0].to
  }

  // Preview the edge that will be taken from the target node
  let nextEdgeId: string | null = null
  if (targetId !== 'end' && graph.nodes[targetId]) {
    const preview = pickEdge(graph, targetId, store)
    if (preview) nextEdgeId = `${preview.from}->${preview.to}`
  }

  return { nextId: targetId, visitedId: current, edgeKey, newStore: store, nextEdgeId }
}

export function useFlowRuntime(options: FlowRuntimeOptions = {}): FlowRuntime {
  const { result: resultProp, dsl } = options

  const parsed = useMemo(
    () => (resultProp === undefined && dsl !== undefined ? parse(dsl) : null),
    [resultProp, dsl],
  )
  const result: ParseResult | null = resultProp !== undefined ? resultProp : parsed
  const baseGraph = result?.ok ? result.graph : null

  const [currentStep, setCurrentStep] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [visitedNodes, setVisitedNodes] = useState<Set<string>>(() => new Set())
  const [traversedEdges, setTraversedEdges] = useState<Set<string>>(() => new Set())
  const [activeEdge, setActiveEdge] = useState<string | null>(null)
  const [nextEdgeId, setNextEdgeId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [speed, setSpeedState] = useState<number>(() => options.speed ?? 1)
  const [mode, setModeState] = useState<RunMode>(() => options.mode ?? 'once')

  // The store is keyed by graph identity, so a new graph re-initialises without an effect.
  const [storeState, setStoreState] = useState<{ graph: FlowGraph | null; store: VarStore }>(() => ({
    graph: baseGraph,
    store: baseGraph ? initStore(baseGraph.vars) : {},
  }))
  const varStore = useMemo(
    () => (storeState.graph === baseGraph ? storeState.store : baseGraph ? initStore(baseGraph.vars) : {}),
    [storeState, baseGraph],
  )

  const graph = useMemo(() => (baseGraph ? interpolateGraph(baseGraph, varStore) : null), [baseGraph, varStore])

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentStepRef = useRef<string | null>(currentStep)
  const visitedRef = useRef<Set<string>>(visitedNodes)
  const traversedRef = useRef<Set<string>>(traversedEdges)
  const storeRef = useRef<VarStore>(varStore)
  const speedRef = useRef(speed)
  const modeRef = useRef(mode)
  const graphRef = useRef<FlowGraph | null>(graph)
  const baseGraphRef = useRef<FlowGraph | null>(baseGraph)

  useEffect(() => {
    currentStepRef.current = currentStep
    visitedRef.current = visitedNodes
    traversedRef.current = traversedEdges
    storeRef.current = varStore
    speedRef.current = speed
    modeRef.current = mode
    graphRef.current = graph
    baseGraphRef.current = baseGraph
  }, [currentStep, visitedNodes, traversedEdges, varStore, speed, mode, graph, baseGraph])

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setRunning(false)
  }, [])

  const clearStep = useCallback(() => {
    setCurrentStep(null)
    setStepIndex(0)
    setVisitedNodes(new Set())
    setTraversedEdges(new Set())
    setActiveEdge(null)
    setNextEdgeId(null)
    currentStepRef.current = null
    visitedRef.current = new Set()
    traversedRef.current = new Set()
  }, [])

  const setVarStore = useCallback((updater: VarStore | ((prev: VarStore) => VarStore)) => {
    setStoreState((prev) => {
      const active = baseGraphRef.current
      const current = prev.graph === active ? prev.store : active ? initStore(active.vars) : {}
      return { graph: active, store: typeof updater === 'function' ? updater(current) : updater }
    })
  }, [])

  useEffect(() => () => stop(), [stop])

  const applyStep = useCallback((result: StepResult) => {
    const nextVisited = new Set(visitedRef.current).add(result.visitedId)
    const nextTraversed = new Set(traversedRef.current).add(result.edgeKey)
    visitedRef.current = nextVisited
    traversedRef.current = nextTraversed
    currentStepRef.current = result.nextId
    storeRef.current = result.newStore

    setVisitedNodes(nextVisited)
    setTraversedEdges(nextTraversed)
    setCurrentStep(result.nextId)
    setStepIndex((i) => i + 1)
    setActiveEdge(result.edgeKey)
    setNextEdgeId(result.nextEdgeId)
    setVarStore(result.newStore)
  }, [setVarStore])

  const step = useCallback(() => {
    const activeGraph = graphRef.current
    if (!activeGraph) return
    const result = advance(activeGraph, currentStepRef.current, storeRef.current)
    if (!result) return
    applyStep(result)
  }, [applyStep])

  const run = useCallback(() => {
    if (timerRef.current) {
      stop()
      return
    }

    setRunning(true)

    const tick = () => {
      const activeGraph = graphRef.current
      if (!activeGraph) {
        setRunning(false)
        timerRef.current = null
        return
      }

      const result = advance(activeGraph, currentStepRef.current, storeRef.current)

      if (!result) {
        if (modeRef.current === 'repeat') {
          const fresh = initStore(activeGraph.vars)
          storeRef.current = fresh
          setVarStore(fresh)
          clearStep()
          timerRef.current = setTimeout(tick, speedRef.current * 1000)
        } else {
          setRunning(false)
          timerRef.current = null
        }
        return
      }

      applyStep(result)
      timerRef.current = setTimeout(tick, speedRef.current * 1000)
    }

    tick()
  }, [applyStep, clearStep, stop, setVarStore])

  const reset = useCallback(() => {
    stop()
    clearStep()
    const activeGraph = graphRef.current
    const fresh = activeGraph ? initStore(activeGraph.vars) : {}
    storeRef.current = fresh
    setVarStore(fresh)
  }, [clearStep, stop, setVarStore])

  const setSpeed = useCallback((next: number) => {
    speedRef.current = next
    setSpeedState(next)
  }, [])

  const setMode = useCallback((next: RunMode) => {
    modeRef.current = next
    setModeState(next)
  }, [])

  return {
    result,
    graph,
    currentStep,
    stepIndex,
    visitedNodes,
    traversedEdges,
    activeEdge,
    nextEdgeId,
    varStore,
    setVarStore,
    running,
    speed,
    mode,
    setSpeed,
    setMode,
    canStep: !!graph && currentStep !== 'end' && !running,
    step,
    run,
    stop,
    reset,
  }
}
