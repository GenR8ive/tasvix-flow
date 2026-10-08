import { useRef, useEffect } from 'react'
import rough from 'roughjs'
import type { Options } from 'roughjs/bundled/core'

// Deterministic seed from a string, clamped to 32-bit int for Rough.js
export function hashSeed(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  }
  return Math.abs(h) % 2147483647
}

export function diamondPath(w: number, h: number): string {
  const cx = w / 2, cy = h / 2
  return `M${cx},0 L${w},${cy} L${cx},${h} L0,${cy} Z`
}

export function parallelogramPath(w: number, h: number, skew = 16): string {
  return `M${skew},0 L${w},0 L${w - skew},${h} L0,${h} Z`
}

export type SketchShapeType = 'rectangle' | 'pill' | 'diamond' | 'parallelogram' | 'dotted-rect'

interface SketchShapeProps {
  shape: SketchShapeType
  width: number
  height: number
  seed: number
  stroke: string
  fill?: string
  fillStyle?: string
  strokeWidth?: number
  roughness?: number
  bowing?: number
  borderRadius?: number
  offset?: { top: number; left: number }
}

export function SketchShape({
  shape, width, height, seed, stroke, fill, fillStyle,
  strokeWidth = 2.5, roughness = 1.2, bowing = 2,
  borderRadius, offset,
}: SketchShapeProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    while (svg.firstChild) svg.removeChild(svg.firstChild)

    const rc = rough.svg(svg)
    const options: Options = {
      seed,
      stroke,
      strokeWidth,
      roughness,
      bowing,
      fill: fill ?? 'none',
      fillStyle: fill ? (fillStyle ?? 'hachure') : undefined,
      fillWeight: fill ? 1.5 : undefined,
    }

    let node: SVGGElement

    switch (shape) {
      case 'pill': {
        const r = borderRadius ?? Math.min(width, height) / 2
        node = rc.rectangle(0, 0, width, height, { ...options, borderRadius: r } as Options)
        break
      }
      case 'diamond':
        node = rc.path(diamondPath(width, height), options)
        break
      case 'parallelogram':
        node = rc.path(parallelogramPath(width, height), options)
        break
      case 'dotted-rect':
        node = rc.rectangle(0, 0, width, height, {
          ...options,
          strokeLineDash: [4, 4],
          roughness: 0.8,
          fillStyle: 'solid',
        })
        break
      default: {
        const r = borderRadius ?? 8
        node = rc.rectangle(0, 0, width, height, { ...options, borderRadius: r } as Options)
      }
    }

    svg.appendChild(node)
  }, [shape, width, height, seed, stroke, fill, fillStyle, strokeWidth, roughness, bowing, borderRadius])

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        top: offset?.top ?? 0,
        left: offset?.left ?? 0,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    />
  )
}

interface SketchEdgeProps {
  d: string
  seed: number
  stroke: string
  strokeWidth: number
  strokeDasharray?: string
}

export function SketchEdge({ d, seed, stroke, strokeWidth, strokeDasharray }: SketchEdgeProps) {
  const gRef = useRef<SVGGElement>(null)

  useEffect(() => {
    const g = gRef.current
    if (!g || !d) return

    while (g.firstChild) g.removeChild(g.firstChild)

    const svg = g.closest('svg')
    if (!svg) return

    const rc = rough.svg(svg)

    const pathNode = rc.path(d, {
      seed,
      stroke,
      strokeWidth,
      roughness: 1,
      bowing: 1.5,
      strokeLineDash: strokeDasharray ? [6, 3] : undefined,
    })
    g.appendChild(pathNode)

    // Invisible wider hit area for reliable click interaction
    const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    hitArea.setAttribute('d', d)
    hitArea.setAttribute('stroke', 'transparent')
    hitArea.setAttribute('stroke-width', String(Math.max(strokeWidth + 8, 12)))
    hitArea.setAttribute('fill', 'none')
    g.appendChild(hitArea)
  }, [d, seed, stroke, strokeWidth, strokeDasharray])

  return <g ref={gRef} />
}
