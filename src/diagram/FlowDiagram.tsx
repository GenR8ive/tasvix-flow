import { useMemo, useEffect, useState, useCallback, forwardRef, useImperativeHandle, useRef } from 'react'
import { ReactFlow, Background, BaseEdge, EdgeLabelRenderer, useReactFlow, type Node, type Edge, type EdgeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './flow.css'
import type { FlowGraph } from '../core/types'
import { computeLayout, dedupePoints, type FlowDirection } from './layout'
import { StartNode, EndNode, ProcessNode, IONode, DecisionNode, GroupNode, type FlowNodeData } from './nodes'
import type { DiagramStyle, EdgeShape, FlowColors } from './styles'
import { getEdgeStyleOverrides, getBackgroundConfig, colorVars } from './styles'
import { buildEdgePath, edgeLabelAnchor } from './edgePath'
import { SketchEdge, hashSeed } from './sketch'

interface ContextMenuState {
  x: number
  y: number
  nodeId: string
}

export type GroupView = 'containers' | 'tags' | 'hidden'

export type CameraMode = 'follow' | 'free'

interface FlowDiagramProps {
  graph: FlowGraph
  currentStep: string | null
  stepIndex?: number
  activeEdge?: string | null
  visitedNodes: Set<string>
  traversedEdges: Set<string>
  cameraMode?: CameraMode
  cameraDuration?: number
  nextEdgeId: string | null
  selectedNodeId?: string | null
  connectingFromId?: string | null
  labelOverrides?: Record<string, string>
  direction?: FlowDirection
  diagramStyle?: DiagramStyle
  /** Palette overrides for this diagram instance (CSS custom properties). */
  colors?: FlowColors
  edgeShape?: EdgeShape
  groupView?: GroupView
  onNodeClick?: (id: string) => void
  onPaneClick?: () => void
  onStartConnection?: (fromId: string) => void
  onNodeLabelChange?: (nodeId: string, newLabel: string) => void
  containerRef?: React.Ref<HTMLDivElement>
}

const nodeTypes = {
  start: StartNode,
  end: EndNode,
  process: ProcessNode,
  io: IONode,
  decision: DecisionNode,
  group: GroupNode,
}

function DagreEdge({ data, style, label, labelStyle, labelBgStyle }: EdgeProps) {
  const points = data?.points as { x: number; y: number }[] | undefined
  const edgeStyle = data?.diagramStyle as DiagramStyle | undefined
  const edgeKey = data?.edgeKey as string | undefined
  const shape = (data?.edgeShape as EdgeShape | undefined) ?? 'polyline'
  if (!points || points.length < 2) return null

  const pts = dedupePoints(points)
  if (pts.length < 2) return null

  const path = buildEdgePath(pts, shape)
  const mid = edgeLabelAnchor(pts, shape)
  const labelX = mid.x
  const labelY = mid.y

  const isSketch = edgeStyle === 'sketch'
  const isFlow = data?.flowClass === true

  return (
    <>
      {isSketch ? (
        <SketchEdge
          d={path}
          seed={hashSeed(edgeKey ?? '')}
          stroke={(style?.stroke as string) ?? 'var(--text-muted)'}
          strokeWidth={(style?.strokeWidth as number) ?? 2}
          strokeDasharray={style?.strokeDasharray as string | undefined}
        />
      ) : (
        <BaseEdge path={path} style={style} className={isFlow ? 'tv-edge-flow' : undefined} />
      )}
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              fontSize: 12,
              fontFamily: 'var(--sans)',
              fontWeight: 600,
              letterSpacing: '0.02em',
              ...(labelStyle as React.CSSProperties),
              background: labelBgStyle?.fill ?? 'var(--bg)',
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid var(--border)',
              boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
              whiteSpace: 'nowrap',
              textTransform: 'lowercase',
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const edgeTypes = { dagre: DagreEdge }

function CameraTracker({ currentStep, follow, duration = 800 }: { currentStep: string | null; follow: boolean; duration?: number }) {
  const { fitView, getZoom } = useReactFlow()
  const initialZoomRef = useRef<number | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Store the initial zoom level when following starts
  useEffect(() => {
    if (follow && currentStep && initialZoomRef.current === null) {
      initialZoomRef.current = getZoom()
    }
    if (!follow || !currentStep) {
      initialZoomRef.current = null
    }
  }, [follow, currentStep, getZoom])

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    if (!currentStep || !follow) return

    const storedZoom = initialZoomRef.current ?? getZoom()

    timeoutRef.current = setTimeout(() => {
      fitView({
        nodes: [{ id: currentStep }],
        padding: 2.5,
        duration,
        maxZoom: storedZoom,
        minZoom: storedZoom,
      })
    }, 50)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [currentStep, follow, duration, fitView, getZoom])

  return null
}

function FitViewHandle({ handleRef, positions, nodes: flowNodes, nodeDimensions }: { handleRef: React.Ref<FlowDiagramHandle>; positions: Record<string, { x: number; y: number }>; nodes: Node<FlowNodeData>[]; nodeDimensions: Record<string, { width: number; height: number }> }) {
  const { setViewport, getNodes } = useReactFlow()
  useImperativeHandle(handleRef, () => ({
    fitView: () => {
      const nodes = Object.values(positions)
      if (nodes.length === 0) return
      const container = document.querySelector('.react-flow__viewport')?.parentElement
      if (!container) return
      const cw = container.clientWidth
      const ch = container.clientHeight
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const [nodeId, p] of Object.entries(positions)) {
        if (nodeId.startsWith('__group_')) continue
        const dims = nodeDimensions[nodeId] || { width: 170, height: 48 }
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x + dims.width)
        maxY = Math.max(maxY, p.y + dims.height)
      }
      const graphW = maxX - minX
      const graphH = maxY - minY
      const pad = 0.3
      const zoom = Math.min(cw / (graphW * (1 + pad * 2)), ch / (graphH * (1 + pad * 2)))
      const cx = minX + graphW / 2
      const cy = minY + graphH / 2
      setViewport({
        x: cw / 2 - cx * zoom,
        y: ch / 2 - cy * zoom,
        zoom,
      }, { duration: 0 })
    },
    getExportData: (padding?: number) => {
      const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement | null
      if (!viewportEl) return null
      const pad = padding ?? 0
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const [nodeId, pos] of Object.entries(positions)) {
        const dims = nodeDimensions[nodeId] || { width: 170, height: 48 }
        if (!pos) continue
        minX = Math.min(minX, pos.x)
        minY = Math.min(minY, pos.y)
        maxX = Math.max(maxX, pos.x + dims.width)
        maxY = Math.max(maxY, pos.y + dims.height)
      }
      if (minX === Infinity) return null
      const boundsW = maxX - minX
      const boundsH = maxY - minY
      const imageWidth = Math.ceil(boundsW + pad * 2)
      const imageHeight = Math.ceil(boundsH + pad * 2)
      if (!imageWidth || !imageHeight) return null
      return {
        element: viewportEl,
        viewport: { x: pad - minX, y: pad - minY, zoom: 1 },
        imageWidth,
        imageHeight,
      }
    },
  }), [setViewport, getNodes, positions, flowNodes, nodeDimensions])
  return null
}

function ContextMenu({
  menu,
  graph,
  onClose,
  onStartConnection,
}: {
  menu: ContextMenuState
  graph: FlowGraph
  onClose: () => void
  onStartConnection: (fromId: string) => void
}) {
  const node = graph.nodes[menu.nodeId]
  if (!node) return null

  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose() }}
    >
      <div
        className="absolute rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-lg py-1 min-w-[160px]"
        style={{ left: menu.x, top: menu.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-1.5 text-[11px] font-medium text-[var(--text-muted)] border-b border-[var(--border)] truncate">
          {node.label}
        </div>
        <button
          type="button"
          onClick={() => { onStartConnection(menu.nodeId); onClose() }}
          className="w-full text-left px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors cursor-pointer bg-transparent border-none flex items-center gap-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
          Add Connection
        </button>
      </div>
    </div>
  )
}

export interface FlowDiagramHandle {
  fitView: () => void
  getExportData: (padding?: number) => {
    element: HTMLElement
    viewport: { x: number; y: number; zoom: number }
    imageWidth: number
    imageHeight: number
  } | null
}

const FlowDiagramForward = forwardRef(function FlowDiagram({ graph, currentStep, stepIndex, activeEdge, visitedNodes, traversedEdges, cameraMode = 'free', cameraDuration, nextEdgeId, selectedNodeId, connectingFromId, labelOverrides, direction, diagramStyle, colors, edgeShape = 'polyline', groupView = 'containers', onNodeClick, onPaneClick, onStartConnection, onNodeLabelChange, containerRef }: FlowDiagramProps, ref: React.Ref<FlowDiagramHandle>) {
  const { positions, edgePaths, nodeDimensions, groupRects } = useMemo(() => computeLayout(graph, direction, groupView === 'containers'), [graph, direction, groupView])
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handleNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    if (connectingFromId && connectingFromId !== node.id) {
      onNodeClick?.(node.id)
    } else {
      onNodeClick?.(node.id)
    }
  }, [connectingFromId, onNodeClick])

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id })
  }, [])

  const handlePaneClick = useCallback(() => {
    closeContextMenu()
    setEditingNodeId(null)
    onPaneClick?.()
  }, [closeContextMenu, onPaneClick])

  const handleEditStart = useCallback((nodeId: string) => {
    setEditingNodeId(nodeId)
  }, [])

  const handleEditEnd = useCallback((nodeId: string, newLabel: string) => {
    setEditingNodeId(null)
    if (newLabel && newLabel !== graph.nodes[nodeId]?.label) {
      onNodeLabelChange?.(nodeId, newLabel)
    }
  }, [graph.nodes, onNodeLabelChange])

  const handleNodeDoubleClick = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault()
    e.stopPropagation()
    handleEditStart(node.id)
  }, [handleEditStart])

  const groupLabels = useMemo(() => {
    const map: Record<string, { label: string; color?: string }> = {}
    for (const g of graph.groups) {
      for (const n of Object.values(graph.nodes)) {
        if (n.props.in === g.id) map[n.id] = { label: g.label, color: g.props.color }
      }
    }
    return map
  }, [graph])

  const nodes: Node<FlowNodeData>[] = useMemo(() => {
    const flowNodes = Object.values(graph.nodes).map((node) => {
      const pos = positions[node.id] ?? { x: 0, y: 0 }
      return {
        id: node.id,
        type: node.type,
        position: { x: pos.x, y: pos.y },
        data: {
          label: labelOverrides?.[node.id] ?? node.label,
          nodeType: node.type,
          diagramStyle,
          isActive: node.id === currentStep,
          isVisited: visitedNodes.has(node.id),
          stepIndex,
          isSelected: node.id === selectedNodeId,
          isConnectingSource: node.id === connectingFromId,
          isEditing: node.id === editingNodeId,
          onEditStart: () => handleEditStart(node.id),
          onEditEnd: (newLabel: string) => handleEditEnd(node.id, newLabel),
          props: node.props,
          direction,
          computedWidth: nodeDimensions[node.id]?.width,
          computedHeight: nodeDimensions[node.id]?.height,
          groupLabel: groupView === 'tags' ? groupLabels[node.id] : undefined,
        },
      }
    })

    const groupNodes: Node<FlowNodeData>[] = groupView === 'containers'
      ? graph.groups
          .filter((g) => groupRects[g.id])
          .map((g) => {
            const rect = groupRects[g.id]
            return {
              id: `__group_${g.id}`,
              type: 'group',
              position: { x: rect.x, y: rect.y },
              style: { border: 'none', outline: 'none', boxShadow: 'none', background: 'transparent', padding: 0 },
              data: {
                label: g.label,
                nodeType: 'process',
                isActive: !!currentStep && Object.values(graph.nodes).some(n => n.id === currentStep && n.props.in === g.id),
                isVisited: Object.values(graph.nodes).some(n => visitedNodes.has(n.id) && n.props.in === g.id),
                props: g.props,
                direction,
                computedWidth: rect.width,
                computedHeight: rect.height,
              },
              zIndex: -1,
              selectable: false,
              draggable: false,
            }
          })
      : []

    return [...groupNodes, ...flowNodes]
  }, [graph, positions, groupRects, nodeDimensions, direction, diagramStyle, groupView, groupLabels, currentStep, stepIndex, visitedNodes, selectedNodeId, connectingFromId, labelOverrides, editingNodeId, handleEditStart, handleEditEnd])

  const groupIds = useMemo(() => new Set(graph.groups.map(g => g.id)), [graph])

  const toFlowId = useCallback((id: string) =>
    groupIds.has(id) ? `__group_${id}` : id,
    [groupIds],
  )

  const edgeStyleResult = useMemo(() => getEdgeStyleOverrides(diagramStyle ?? 'standard'), [diagramStyle])

  const edges: Edge[] = useMemo(() => {
    return graph.edges.map((e) => {
      const key = `${e.from}->${e.to}`
      const isTraversed = traversedEdges.has(key)
      const isNext = key === nextEdgeId && !isTraversed
      const isActiveEdge = key === activeEdge
      const isBack = positions[e.to] && positions[e.from] && positions[e.to].y <= positions[e.from].y

      return {
        id: key,
        source: toFlowId(e.from),
        target: toFlowId(e.to),
        type: 'dagre',
        data: { points: edgePaths[key], diagramStyle, edgeShape, edgeKey: key, flowClass: isActiveEdge },
        label: e.condition !== undefined ? String(e.condition) : undefined,
        animated: isTraversed,
        style: {
          stroke: isTraversed ? 'var(--accent)' : isNext ? 'var(--accent)' : edgeStyleResult.defaultStroke,
          strokeWidth: isTraversed ? edgeStyleResult.traversedWidth : isNext ? 2 : edgeStyleResult.defaultWidth,
          strokeOpacity: isTraversed ? 1 : isNext ? 0.45 : 1,
          strokeLinecap: edgeStyleResult.strokeLinecap,
          strokeDasharray: isActiveEdge ? undefined : isBack ? '6 3' : undefined,
        },
        labelStyle: {
          color: isTraversed ? 'var(--accent)' : isNext ? 'var(--accent)' : 'var(--text-muted)',
          ...edgeStyleResult.labelFont,
        },
        labelBgStyle: {
          fill: 'var(--preview-bg)',
          ...edgeStyleResult.labelBg,
        },
      }
    })
  }, [graph, positions, edgePaths, traversedEdges, nextEdgeId, activeEdge, toFlowId, edgeStyleResult, edgeShape, diagramStyle])

  const bgConfig = useMemo(() => getBackgroundConfig(diagramStyle ?? 'standard'), [diagramStyle])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', ...colorVars(colors) }} className={connectingFromId ? 'cursor-crosshair' : ''}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        zoomOnDoubleClick={false}
        minZoom={0.3}
        maxZoom={2}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={handlePaneClick}
      >
        <Background gap={bgConfig.gap} size={bgConfig.size} color="var(--border)" />
        <CameraTracker currentStep={currentStep} follow={cameraMode === 'follow'} duration={cameraDuration} />
        <FitViewHandle handleRef={ref} positions={positions} nodes={nodes} nodeDimensions={nodeDimensions} />
      </ReactFlow>
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          graph={graph}
          onClose={closeContextMenu}
          onStartConnection={onStartConnection ?? (() => {})}
        />
      )}
      {connectingFromId && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-[var(--accent)] text-white text-xs font-medium shadow-md pointer-events-none">
          Click a node to connect
        </div>
      )}
    </div>
  )
})

export default FlowDiagramForward
