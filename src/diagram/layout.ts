import dagre from '@dagrejs/dagre'
import type { FlowGraph } from '../core/types'
import { calculateNodeDimensions } from './textMeasurement'

const MIN_NODE_W = 120
const MAX_NODE_W = 280
const DEFAULT_GROUP_W = 160
const DEFAULT_GROUP_H = 80
const NODE_SEP = 70
const RANK_SEP = 64
const SUB_SEP = 24
const DEFAULT_MAX_RANK_WIDTH = 720

export type FlowDirection = 'TB' | 'LR'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function dedupePoints(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue
    out.push(p)
  }
  return out
}

interface LayoutItem {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * Re-pack dagre ranks into wrapped sub-rows so many same-level children
 * stay compact instead of one very wide row. Mutates `positions`.
 * Returns true when any rank wrapped (all ranks were re-placed).
 */
function compactPositions(
  positions: Record<string, { x: number; y: number }>,
  nodeDimensions: Record<string, { width: number; height: number }>,
  direction: FlowDirection,
  maxRankWidth: number,
): boolean {
  const items: LayoutItem[] = Object.entries(positions).map(([id, p]) => {
    const dims = nodeDimensions[id] ?? { width: 170, height: 48 }
    return { id, x: p.x, y: p.y, w: dims.width, h: dims.height }
  })
  if (items.length === 0) return false

  const tb = direction === 'TB'
  const buckets = new Map<number, LayoutItem[]>()
  for (const it of items) {
    const primary = tb ? it.y + it.h / 2 : it.x + it.w / 2
    const key = Math.round(primary / 5) * 5
    const bucket = buckets.get(key)
    if (bucket) bucket.push(it)
    else buckets.set(key, [it])
  }

  const ranks = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, rankItems]) => {
      rankItems.sort((a, b) =>
        tb ? (a.x + a.w / 2) - (b.x + b.w / 2) : (a.y + a.h / 2) - (b.y + b.h / 2))

      const rows: { items: LayoutItem[]; extent: number }[] = []
      let row: LayoutItem[] = []
      let extent = 0
      for (const it of rankItems) {
        const size = tb ? it.w : it.h
        const gap = row.length > 0 ? NODE_SEP : 0
        if (row.length > 0 && extent + gap + size > maxRankWidth) {
          rows.push({ items: row, extent })
          row = [it]
          extent = size
        } else {
          extent += gap + size
          row.push(it)
        }
      }
      if (row.length > 0) rows.push({ items: row, extent })
      return { key, rows }
    })

  if (!ranks.some((r) => r.rows.length > 1)) return false

  const maxCross = Math.max(...ranks.flatMap((r) => r.rows.map((row) => row.extent)))
  const center = maxCross / 2

  let cursor = 0
  for (const rank of ranks) {
    const rowCross = rank.rows.map((row) =>
      tb ? Math.max(...row.items.map((i) => i.h)) : Math.max(...row.items.map((i) => i.w)))
    let p = cursor
    rank.rows.forEach((row, ri) => {
      let cross = center - row.extent / 2
      for (const it of row.items) {
        if (tb) {
          positions[it.id] = { x: cross, y: p }
          cross += it.w + NODE_SEP
        } else {
          positions[it.id] = { x: p, y: cross }
          cross += it.h + NODE_SEP
        }
      }
      p += rowCross[ri] + SUB_SEP
    })
    const rankExtent = rowCross.reduce((a, b) => a + b, 0) + SUB_SEP * (rank.rows.length - 1)
    cursor += rankExtent + RANK_SEP
  }
  return true
}

// ── Corridor routing (after wrap) ─────────────────────────────────────────
// Orthogonal paths that travel through the empty gaps between wrapped rows
// and ranks (Mermaid/dagre-like corridors) instead of cutting across nodes.

const ROUTE_CELL = 10
const TURN_COST = 6
const USAGE_COST = 3

interface RouteGrid {
  x0: number
  y0: number
  cols: number
  rows: number
  blocked: Uint8Array
  usage: Uint16Array
}

interface HeapItem {
  f: number
  state: number
}

function heapPush(h: HeapItem[], item: HeapItem): void {
  h.push(item)
  let i = h.length - 1
  while (i > 0) {
    const p = (i - 1) >> 1
    if (h[p].f <= item.f) break
    h[i] = h[p]
    i = p
  }
  h[i] = item
}

function heapPop(h: HeapItem[]): HeapItem {
  const top = h[0]
  const last = h.pop()!
  if (h.length > 0) {
    let i = 0
    for (;;) {
      const l = i * 2 + 1
      const r = l + 1
      let m = i
      if (l < h.length && h[l].f < h[m].f) m = l
      if (r < h.length && h[r].f < h[m].f) m = r
      if (m === i) break
      const t = h[m]
      h[m] = h[i]
      h[i] = t
      i = m
    }
    h[i] = last
  }
  return top
}

function clampIndex(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function cellIndex(g: RouteGrid, x: number, y: number): number {
  const i = clampIndex(Math.floor((x - g.x0) / ROUTE_CELL), 0, g.cols - 1)
  const j = clampIndex(Math.floor((y - g.y0) / ROUTE_CELL), 0, g.rows - 1)
  return j * g.cols + i
}

function rectCells(g: RouteGrid, r: Rect): number[] {
  const i0 = clampIndex(Math.floor((r.x - g.x0) / ROUTE_CELL), 0, g.cols - 1)
  const j0 = clampIndex(Math.floor((r.y - g.y0) / ROUTE_CELL), 0, g.rows - 1)
  const i1 = clampIndex(Math.floor((r.x + r.width - g.x0) / ROUTE_CELL), 0, g.cols - 1)
  const j1 = clampIndex(Math.floor((r.y + r.height - g.y0) / ROUTE_CELL), 0, g.rows - 1)
  const out: number[] = []
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) out.push(j * g.cols + i)
  }
  return out
}

function buildRouteGrid(bounds: Rect[], blocked: Rect[]): RouteGrid {
  const minX = Math.min(...bounds.map((r) => r.x)) - 80
  const minY = Math.min(...bounds.map((r) => r.y)) - 80
  const maxX = Math.max(...bounds.map((r) => r.x + r.width)) + 80
  const maxY = Math.max(...bounds.map((r) => r.y + r.height)) + 80
  const cols = Math.max(1, Math.ceil((maxX - minX) / ROUTE_CELL))
  const rows = Math.max(1, Math.ceil((maxY - minY) / ROUTE_CELL))
  const grid: RouteGrid = {
    x0: minX,
    y0: minY,
    cols,
    rows,
    blocked: new Uint8Array(cols * rows),
    usage: new Uint16Array(cols * rows),
  }
  for (const r of blocked) {
    for (const c of rectCells(grid, r)) grid.blocked[c] = 1
  }
  return grid
}

function pointInRect(p: { x: number; y: number }, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

/**
 * Border point of `rect` such that the segment to `t` stays axis-aligned,
 * so node stubs never render as diagonals.
 */
function alignedBorderPoint(rect: Rect, t: { x: number; y: number }): { x: number; y: number } | null {
  const eps = 0.01
  if (t.x >= rect.x - eps && t.x <= rect.x + rect.width + eps) {
    return { x: t.x, y: t.y < rect.y ? rect.y : rect.y + rect.height }
  }
  if (t.y >= rect.y - eps && t.y <= rect.y + rect.height + eps) {
    return { x: t.x < rect.x ? rect.x : rect.x + rect.width, y: t.y }
  }
  return null
}

function collapseCollinear(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length < 3) return pts
  const out = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    if (Math.abs(cross) > 0.001) out.push(b)
  }
  out.push(pts[pts.length - 1])
  return out
}

/** A* over the cell grid; returns cell-center polyline trimmed to node borders. */
function routePath(g: RouteGrid, from: Rect, to: Rect): { x: number; y: number }[] | null {
  const start = cellIndex(g, from.x + from.width / 2, from.y + from.height / 2)
  const goal = cellIndex(g, to.x + to.width / 2, to.y + to.height / 2)
  const own = new Set<number>([...rectCells(g, from), ...rectCells(g, to)])

  const cellCount = g.cols * g.rows
  const best = new Float32Array(cellCount * 4).fill(Infinity)
  const prev = new Int32Array(cellCount * 4).fill(-1)
  const gi = goal % g.cols
  const gj = (goal / g.cols) | 0
  const h = (cell: number): number =>
    Math.abs((cell % g.cols) - gi) + Math.abs(((cell / g.cols) | 0) - gj)

  const heap: HeapItem[] = []
  for (let d = 0; d < 4; d++) {
    const s = start * 4 + d
    best[s] = 0
    heapPush(heap, { f: h(start), state: s })
  }

  const DX = [1, 0, -1, 0]
  const DY = [0, 1, 0, -1]
  let endState = -1

  while (heap.length > 0) {
    const { f, state } = heapPop(heap)
    const cell = state >> 2
    const dir = state & 3
    const gcur = best[state]
    if (f > gcur + h(cell) + 0.001) continue
    if (cell === goal) {
      endState = state
      break
    }
    for (let nd = 0; nd < 4; nd++) {
      const ni = (cell % g.cols) + DX[nd]
      const nj = ((cell / g.cols) | 0) + DY[nd]
      if (ni < 0 || nj < 0 || ni >= g.cols || nj >= g.rows) continue
      const nc = nj * g.cols + ni
      const isOwn = own.has(nc)
      if (g.blocked[nc] === 1 && !isOwn) continue
      const step = 1 + (isOwn ? 0 : g.usage[nc] * USAGE_COST)
      const ng = gcur + step + (nd === dir ? 0 : TURN_COST)
      const ns = nc * 4 + nd
      if (ng < best[ns]) {
        best[ns] = ng
        prev[ns] = state
        heapPush(heap, { f: ng + h(nc), state: ns })
      }
    }
  }
  if (endState < 0) return null

  const cells: number[] = []
  let s = endState
  while (s !== -1) {
    const c = s >> 2
    if (cells[cells.length - 1] !== c) cells.push(c)
    s = prev[s]
  }
  cells.reverse()
  for (const c of cells) g.usage[c]++

  const pts = cells.map((c) => ({
    x: g.x0 + ((c % g.cols) + 0.5) * ROUTE_CELL,
    y: g.y0 + (((c / g.cols) | 0) + 0.5) * ROUTE_CELL,
  }))
  const collapsed = collapseCollinear(pts)
  if (collapsed.length < 2) return null

  // Trim inside-the-endpoint-nodes runs down to the node borders.
  let first = collapsed.findIndex((p) => !pointInRect(p, from))
  if (first === -1) return null
  let last = -1
  for (let i = collapsed.length - 1; i >= 0; i--) {
    if (!pointInRect(collapsed[i], to)) {
      last = i
      break
    }
  }
  if (last === -1 || last < first) return null

  const startPt =
    alignedBorderPoint(from, collapsed[first]) ??
    rectBoundaryIntersection(
      collapsed[first].x, collapsed[first].y,
      from.x, from.y, from.width, from.height,
    )
  const endPt =
    alignedBorderPoint(to, collapsed[last]) ??
    rectBoundaryIntersection(
      collapsed[last].x, collapsed[last].y,
      to.x, to.y, to.width, to.height,
    )
  const trimmed = [startPt, ...collapsed.slice(first, last + 1), endPt]
  const final = collapseCollinear(trimmed)
  return final.length >= 2 ? final : null
}

/** Last resort when the grid finds no path (fully enclosed endpoint). */
function fallbackPath(from: Rect, to: Rect): { x: number; y: number }[] {
  const fc = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const tc = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  if (Math.abs(tc.x - fc.x) >= Math.abs(tc.y - fc.y)) {
    const midX = (fc.x + tc.x) / 2
    return [fc, { x: midX, y: fc.y }, { x: midX, y: tc.y }, tc]
  }
  const midY = (fc.y + tc.y) / 2
  return [fc, { x: fc.x, y: midY }, { x: tc.x, y: midY }, tc]
}

/**
 * Route every edge after compaction (dagre points are stale): A* through the
 * corridor grid, sequential edges spread via a usage penalty.
 */
function routeAllEdges(
  graph: FlowGraph,
  positions: Record<string, { x: number; y: number }>,
  nodeDimensions: Record<string, { width: number; height: number }>,
  groupRects: Record<string, Rect>,
): Record<string, { x: number; y: number }[]> {
  const edgePaths: Record<string, { x: number; y: number }[]> = {}

  const rectOf = (id: string): Rect | null => {
    const groupRect = groupRects[id]
    if (groupRect) return groupRect
    const pos = positions[id]
    const dims = nodeDimensions[id]
    return pos && dims ? { x: pos.x, y: pos.y, width: dims.width, height: dims.height } : null
  }

  const bounds: Rect[] = []
  const blockers: Rect[] = []
  for (const node of Object.values(graph.nodes)) {
    const r = rectOf(node.id)
    if (r) {
      bounds.push(r)
      blockers.push(r)
    }
  }
  // Group containers are routing bounds but never blockers (edges must reach members).
  for (const g of Object.values(groupRects)) bounds.push(g)
  if (bounds.length === 0) return edgePaths

  const grid = buildRouteGrid(bounds, blockers)

  for (const edge of graph.edges) {
    const from = rectOf(edge.from)
    const to = rectOf(edge.to)
    if (!from || !to) continue
    const pts = routePath(grid, from, to) ?? fallbackPath(from, to)
    const clean = dedupePoints(pts)
    if (clean.length >= 2) edgePaths[`${edge.from}->${edge.to}`] = clean
  }
  return edgePaths
}

function diamondBoundaryIntersection(
  fromX: number, fromY: number,
  cx: number, cy: number,
  halfSize: number,
): { x: number; y: number } {
  const dx = fromX - cx
  const dy = fromY - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy - halfSize }
  const t = halfSize / (Math.abs(dx) + Math.abs(dy))
  return { x: cx + dx * t, y: cy + dy * t }
}

function rectBoundaryIntersection(
  fromX: number, fromY: number,
  rectX: number, rectY: number, rectW: number, rectH: number,
): { x: number; y: number } {
  const cx = rectX + rectW / 2
  const cy = rectY + rectH / 2
  const dx = fromX - cx
  const dy = fromY - cy

  if (dx === 0 && dy === 0) return { x: cx, y: rectY }

  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)

  const scale = absDx * rectH > absDy * rectW
    ? (rectW / 2) / absDx
    : (rectH / 2) / absDy

  return { x: cx + dx * scale, y: cy + dy * scale }
}

function getCenter(
  id: string,
  positions: Record<string, { x: number; y: number }>,
  nodeDimensions: Record<string, { width: number; height: number }>,
  groupRects: Record<string, { x: number; y: number; width: number; height: number }>,
): { x: number; y: number } | null {
  const rect = groupRects[id]
  if (rect) return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  const pos = positions[id]
  const dims = nodeDimensions[id]
  if (pos && dims) return { x: pos.x + dims.width / 2, y: pos.y + dims.height / 2 }
  return null
}

export function computeLayout(graph: FlowGraph, direction: FlowDirection = 'TB', groupContainers = true, maxRankWidth = DEFAULT_MAX_RANK_WIDTH): {
  positions: Record<string, { x: number; y: number }>
  edgePaths: Record<string, { x: number; y: number }[]>
  nodeDimensions: Record<string, { width: number; height: number }>
  groupRects: Record<string, { x: number; y: number; width: number; height: number }>
} {
  const groupSet = new Set(graph.groups.map(g => g.id))

  // Determine which groups are edge endpoints
  const groupEdgeEndpoints = new Set<string>()
  for (const edge of graph.edges) {
    if (groupSet.has(edge.from)) groupEdgeEndpoints.add(edge.from)
    if (groupSet.has(edge.to)) groupEdgeEndpoints.add(edge.to)
  }

  // Determine which groups have member nodes
  const groupHasMembers = new Set<string>()
  for (const node of Object.values(graph.nodes)) {
    if (node.props.in && groupSet.has(node.props.in)) {
      groupHasMembers.add(node.props.in)
    }
  }

  const g = new dagre.graphlib.Graph({ compound: groupContainers })
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, nodesep: NODE_SEP, ranksep: RANK_SEP, marginx: 60, marginy: 60 })

  const nodeDimensions: Record<string, { width: number; height: number }> = {}

  // Add group nodes first (required before setting children)
  if (groupContainers) {
    for (const group of graph.groups) {
      if (groupHasMembers.has(group.id)) {
        g.setNode(group.id, {})
      }
    }
  }

  // Add regular nodes to dagre
  for (const node of Object.values(graph.nodes)) {
    const dimensions = calculateNodeDimensions(
      node.label,
      node.type,
      MIN_NODE_W,
      MAX_NODE_W
    )
    nodeDimensions[node.id] = dimensions
    g.setNode(node.id, { width: dimensions.width, height: dimensions.height })

    if (groupContainers && node.props.in && groupSet.has(node.props.in)) {
      g.setParent(node.id, node.props.in)
    }
  }

  // Add standalone groups (edge endpoints without member nodes) to dagre
  for (const group of graph.groups) {
    if (!groupEdgeEndpoints.has(group.id)) continue
    if (groupHasMembers.has(group.id)) continue
    nodeDimensions[group.id] = { width: DEFAULT_GROUP_W, height: DEFAULT_GROUP_H }
    g.setNode(group.id, { width: DEFAULT_GROUP_W, height: DEFAULT_GROUP_H })
  }

  // Add edges to dagre
  for (const edge of graph.edges) {
    g.setEdge(edge.from, edge.to)
  }

  dagre.layout(g)

  const positions: Record<string, { x: number; y: number }> = {}
  for (const node of Object.values(graph.nodes)) {
    const n = g.node(node.id)
    if (n) {
      positions[node.id] = {
        x: n.x - n.width / 2,
        y: n.y - n.height / 2,
      }
    }
  }

  // Standalone group positions from dagre
  for (const group of graph.groups) {
    if (!groupEdgeEndpoints.has(group.id)) continue
    if (groupHasMembers.has(group.id)) continue
    const n = g.node(group.id)
    if (n) {
      positions[group.id] = {
        x: n.x - n.width / 2,
        y: n.y - n.height / 2,
      }
    }
  }

  // Wrap wide ranks so many same-level children stay compact
  const didWrap = compactPositions(positions, nodeDimensions, direction, maxRankWidth)

  // Compute group bounding boxes from member node positions
  const groupRects: Record<string, { x: number; y: number; width: number; height: number }> = {}
  const GROUP_PAD = 30
  const GROUP_LABEL_H = 24

  for (const group of graph.groups) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const node of Object.values(graph.nodes)) {
      if (node.props.in !== group.id) continue
      const pos = positions[node.id]
      const dims = nodeDimensions[node.id]
      if (!pos || !dims) continue
      minX = Math.min(minX, pos.x)
      minY = Math.min(minY, pos.y)
      maxX = Math.max(maxX, pos.x + dims.width)
      maxY = Math.max(maxY, pos.y + dims.height)
    }
    if (minX !== Infinity) {
      groupRects[group.id] = {
        x: minX - GROUP_PAD,
        y: minY - GROUP_PAD - GROUP_LABEL_H,
        width: maxX - minX + GROUP_PAD * 2,
        height: maxY - minY + GROUP_PAD * 2 + GROUP_LABEL_H,
      }
    } else if (groupEdgeEndpoints.has(group.id)) {
      // Standalone group: use dagre position
      const pos = positions[group.id]
      const dims = nodeDimensions[group.id] || { width: DEFAULT_GROUP_W, height: DEFAULT_GROUP_H }
      if (pos) {
        groupRects[group.id] = {
          x: pos.x,
          y: pos.y,
          width: dims.width,
          height: dims.height,
        }
      }
    }
  }

  // Edge paths: dagre routes when untouched, own router after compaction
  const edgePaths: Record<string, { x: number; y: number }[]> = {}
  if (didWrap) {
    Object.assign(edgePaths, routeAllEdges(graph, positions, nodeDimensions, groupRects))
  } else {
    for (const edge of graph.edges) {
      const key = `${edge.from}->${edge.to}`
      const dagreEdge = g.edge(edge.from, edge.to)
      if (dagreEdge?.points) {
        edgePaths[key] = dagreEdge.points
      }
    }
  }

  // Compute manual edge paths for edges without dagre paths
  for (const edge of graph.edges) {
    const key = `${edge.from}->${edge.to}`
    if (edgePaths[key]) continue

    const fromIsGroup = groupSet.has(edge.from)
    const toIsGroup = groupSet.has(edge.to)
    if (!fromIsGroup && !toIsGroup) continue

    const fromCenter = getCenter(edge.from, positions, nodeDimensions, groupRects)
    const toCenter = getCenter(edge.to, positions, nodeDimensions, groupRects)
    if (!fromCenter || !toCenter) continue

    const points: { x: number; y: number }[] = []

    if (fromIsGroup) {
      const fromRect = groupRects[edge.from]
      if (fromRect) {
        points.push(rectBoundaryIntersection(toCenter.x, toCenter.y, fromRect.x, fromRect.y, fromRect.width, fromRect.height))
      } else {
        points.push(fromCenter)
      }
    } else {
      points.push(fromCenter)
    }

    // Orthogonal midpoint routing
    if (direction === 'TB') {
      const midY = (points[0].y + toCenter.y) / 2
      points.push({ x: points[points.length - 1].x, y: midY })
      points.push({ x: toCenter.x, y: midY })
    } else {
      const midX = (points[0].x + toCenter.x) / 2
      points.push({ x: midX, y: points[points.length - 1].y })
      points.push({ x: midX, y: toCenter.y })
    }

    if (toIsGroup) {
      const toRect = groupRects[edge.to]
      if (toRect) {
        points.push(rectBoundaryIntersection(points[points.length - 1].x, points[points.length - 1].y, toRect.x, toRect.y, toRect.width, toRect.height))
      } else {
        points.push(toCenter)
      }
    } else {
      points.push(toCenter)
    }

    edgePaths[key] = points
  }

  // Clip edge endpoints at decision node diamond boundaries
  for (const edge of graph.edges) {
    const key = `${edge.from}->${edge.to}`
    const pts = edgePaths[key]
    if (!pts || pts.length < 2) continue

    const srcNode = graph.nodes[edge.from]
    if (srcNode?.type === 'decision') {
      const pos = positions[edge.from]
      const dims = nodeDimensions[edge.from]
      if (pos && dims) {
        const cx = pos.x + dims.width / 2
        const cy = pos.y + dims.height / 2
        const halfSize = Math.min(dims.width, dims.height) / 2 - 2
        const ni = Math.min(1, pts.length - 1)
        pts[0] = diamondBoundaryIntersection(pts[ni].x, pts[ni].y, cx, cy, halfSize)
      }
    }

    const tgtNode = graph.nodes[edge.to]
    if (tgtNode?.type === 'decision') {
      const pos = positions[edge.to]
      const dims = nodeDimensions[edge.to]
      if (pos && dims) {
        const cx = pos.x + dims.width / 2
        const cy = pos.y + dims.height / 2
        const halfSize = Math.min(dims.width, dims.height) / 2 - 2
        const ni = Math.max(pts.length - 2, 0)
        pts[pts.length - 1] = diamondBoundaryIntersection(pts[ni].x, pts[ni].y, cx, cy, halfSize)
      }
    }
  }

  return { positions, edgePaths, nodeDimensions, groupRects }
}
