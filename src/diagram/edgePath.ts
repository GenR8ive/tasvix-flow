import type { EdgeShape } from './styles'

export function pointsToPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return ''
  let d = `M${points[0].x},${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    d += ` L${points[i].x},${points[i].y}`
  }
  return d
}

export function curveToPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return ''
  let d = `M${points[0].x},${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`
  }
  return d
}

export function straightToPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return ''
  const a = points[0]
  const b = points[points.length - 1]
  return `M${a.x},${a.y} L${b.x},${b.y}`
}

export function buildEdgePath(points: { x: number; y: number }[], shape: EdgeShape): string {
  if (shape === 'straight') return straightToPath(points)
  if (shape === 'curve') return curveToPath(points)
  return pointsToPath(points)
}

export function edgeLabelAnchor(points: { x: number; y: number }[], shape: EdgeShape): { x: number; y: number } {
  if (shape === 'straight') {
    const a = points[0]
    const b = points[points.length - 1]
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  const mid = points[Math.floor(points.length / 2)]
  return mid ?? points[0]
}
