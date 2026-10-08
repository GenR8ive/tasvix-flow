import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import FlowDiagram from './diagram/FlowDiagram'
import type { CameraMode, FlowDiagramHandle, GroupView } from './diagram/FlowDiagram'
import type { FlowDirection } from './diagram/layout'
import type { DiagramStyle, EdgeShape, FlowColors } from './diagram/styles'
import { colorVars } from './diagram/styles'
import { useFlowRuntime } from './runtime/useFlowRuntime'
import type { FlowRuntime, RunMode } from './runtime/useFlowRuntime'
import type { FlowGraph, ParseError, ParseResult } from './core/types'

export interface TasvixFlowHandle {
  step: () => void
  run: () => void
  stop: () => void
  reset: () => void
  fitView: () => void
  getGraph: () => FlowGraph | null
  getRuntime: () => FlowRuntime
}

export interface TasvixFlowProps {
  /** DSL source. Parsed internally unless `result` is supplied. */
  dsl?: string
  /** Pre-parsed DSL result. Wins over `dsl`. */
  result?: ParseResult | null
  direction?: FlowDirection
  cameraMode?: CameraMode
  cameraDuration?: number
  diagramStyle?: DiagramStyle
  /** Palette overrides: sets --accent/--border/--bg/... for this instance only. */
  colors?: FlowColors
  /** Path shape for edges: smooth curve, single direct line, or routed polyline. */
  edgeShape?: EdgeShape
  groupView?: GroupView
  /** Seconds between steps while running. */
  speed?: number
  mode?: RunMode
  /** Render the compact run / step / reset bar. */
  controls?: boolean
  containerClassName?: string
  containerStyle?: CSSProperties
  emptyState?: ReactNode
  onStepChange?: (currentStep: string | null, stepIndex: number) => void
  /** Fires when an auto-run ends (finished or stopped). */
  onRunEnd?: () => void
  onError?: (errors: ParseError[]) => void
  onNodeClick?: (id: string) => void
}

const btnCls =
  'px-2.5 h-6 text-[11px] font-medium rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-h)] hover:border-[var(--text-muted)] transition-colors cursor-pointer bg-transparent disabled:opacity-40 disabled:cursor-default'

const TasvixFlow = forwardRef(function TasvixFlow(
  {
    dsl,
    result,
    direction = 'TB',
    cameraMode = 'free',
    cameraDuration,
    diagramStyle = 'standard',
    colors,
    edgeShape = 'polyline',
    groupView = 'containers',
    speed,
    mode,
    controls = false,
    containerClassName,
    containerStyle,
    emptyState,
    onStepChange,
    onRunEnd,
    onError,
    onNodeClick,
  }: TasvixFlowProps,
  ref: React.Ref<TasvixFlowHandle>,
) {
  const runtime = useFlowRuntime({ dsl, result, speed, mode })
  const { graph, result: runtimeResult, currentStep, stepIndex, running, canStep } = runtime
  const diagramHandle = useRef<FlowDiagramHandle>(null)

  useImperativeHandle(
    ref,
    () => ({
      step: runtime.step,
      run: runtime.run,
      stop: runtime.stop,
      reset: runtime.reset,
      fitView: () => diagramHandle.current?.fitView(),
      getGraph: () => graph,
      getRuntime: () => runtime,
    }),
    [runtime, graph],
  )

  const errors = useMemo(
    () => (runtimeResult && !runtimeResult.ok ? runtimeResult.errors : null),
    [runtimeResult],
  )
  const errorSignature = errors ? errors.map((e) => `${e.line}:${e.message}`).join('|') : ''

  useEffect(() => {
    if (!errorSignature || !errors) return
    onError?.(errors)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorSignature])

  const prevStepRef = useRef<{ currentStep: string | null; stepIndex: number }>({
    currentStep: null,
    stepIndex: 0,
  })

  useEffect(() => {
    const prev = prevStepRef.current
    if (prev.stepIndex === stepIndex && prev.currentStep === currentStep) return
    prevStepRef.current = { currentStep, stepIndex }
    onStepChange?.(currentStep, stepIndex)
  }, [currentStep, stepIndex, onStepChange])

  const prevRunningRef = useRef(false)
  useEffect(() => {
    if (prevRunningRef.current && !running) onRunEnd?.()
    prevRunningRef.current = running
  }, [running, onRunEnd])

  return (
    <div
      className={containerClassName}
      style={{ position: 'relative', width: '100%', height: '100%', ...colorVars(colors), ...containerStyle }}
    >
      {graph ? (
        <FlowDiagram
          ref={diagramHandle}
          graph={graph}
          currentStep={currentStep}
          stepIndex={stepIndex}
          activeEdge={runtime.activeEdge}
          visitedNodes={runtime.visitedNodes}
          traversedEdges={runtime.traversedEdges}
          cameraMode={cameraMode}
          cameraDuration={cameraDuration}
          nextEdgeId={runtime.nextEdgeId}
          direction={direction}
          diagramStyle={diagramStyle}
          colors={colors}
          edgeShape={edgeShape}
          groupView={groupView}
          onNodeClick={onNodeClick}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-[var(--text-muted)] p-4">
          {emptyState ??
            (errors ? (
              <div className="space-y-1 text-left">
                {errors.map((err, i) => (
                  <div key={i} className="text-sm font-[var(--mono)] text-red-500">
                    Line {err.line}: {err.message}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm opacity-70">No diagram yet</p>
            ))}
        </div>
      )}

      {controls && graph && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
          <span className="px-2 h-6 inline-flex items-center text-[11px] font-medium text-[var(--text-muted)] rounded border border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-sm">
            {currentStep ? `${stepIndex} · ${currentStep}` : 'Ready'}
          </span>
          <button type="button" className={btnCls} onClick={runtime.run} disabled={!graph}>
            {running ? '■ Stop' : '▶ Run'}
          </button>
          <button type="button" className={btnCls} onClick={runtime.step} disabled={!canStep}>
            ▷ Step
          </button>
          <button type="button" className={btnCls} onClick={runtime.reset} disabled={!currentStep && !running}>
            ↺ Reset
          </button>
        </div>
      )}
    </div>
  )
})

export default TasvixFlow
