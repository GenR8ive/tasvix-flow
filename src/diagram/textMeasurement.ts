/**
 * Text measurement utilities for accurate node sizing
 */

// Character width multipliers for different fonts/sizes
const FONT_METRICS = {
  '13-sans': 0.55,    // 13px sans-serif (regular nodes)
  '12-sans': 0.5,     // 12px sans-serif (decision nodes)
  '11-mono': 0.6,     // 11px monospace (edge labels)
}

const LINE_HEIGHTS = {
  '13-sans': 18,
  '12-sans': 17,
  '11-mono': 16,
}

interface TextDimensions {
  width: number
  height: number
  lineCount: number
}

/**
 * Measure text dimensions accurately
 */
export function measureText(
  text: string,
  fontSize: number,
  fontFamily: 'sans' | 'mono',
  maxWidth: number
): TextDimensions {
  const fontKey = `${fontSize}-${fontFamily}` as keyof typeof FONT_METRICS
  const charWidth = fontSize * FONT_METRICS[fontKey]
  const lineHeight = LINE_HEIGHTS[fontKey] || fontSize * 1.4

  // Split by manual line breaks and measure each line
  const manualLines = text.split('\n')
  const lines: string[] = []

  for (const line of manualLines) {
    if (line.length === 0) {
      lines.push('')
      continue
    }

    // Estimate how many visual lines this text will take
    const estimatedLineWidth = line.length * charWidth
    const visualLines = Math.ceil(estimatedLineWidth / maxWidth)

    if (visualLines <= 1) {
      lines.push(line)
    } else {
      // Split long lines into visual chunks
      const charsPerLine = Math.floor(maxWidth / charWidth)
      for (let i = 0; i < line.length; i += charsPerLine) {
        lines.push(line.slice(i, i + charsPerLine))
      }
    }
  }

  const totalLines = lines.length
  const width = Math.min(maxWidth, Math.max(...manualLines.map(l => l.length * charWidth)))
  const height = totalLines * lineHeight

  return { width, height, lineCount: totalLines }
}

/**
 * Calculate node dimensions based on shape and content
 */
export function calculateNodeDimensions(
  label: string,
  nodeType: 'start' | 'end' | 'process' | 'io' | 'decision',
  minWidth: number = 120,
  maxWidth: number = 250
): { width: number; height: number } {
  const fontSize = nodeType === 'decision' ? 12 : 13
  const fontFamily = 'sans'

  // Get text dimensions
  const textDim = measureText(label, fontSize, fontFamily, maxWidth - 32)

  // Base padding
  const paddingX = nodeType === 'decision' ? 20 : 28
  const paddingY = nodeType === 'decision' ? 24 : 20

  // Shape-specific calculations
  switch (nodeType) {
    case 'decision': {
      // Diamond shape: diagonal edges reduce usable space
      // Need more width because text is constrained by diamond geometry
      const minDiamondSize = 68
      const maxDiamondSize = 140

      // Calculate diamond size (diamond is rotated square)
      // The text width is the diagonal of the diamond
      const textDiagonal = textDim.width + paddingX * 2
      const diamondSide = Math.ceil(textDiagonal / 1.414) // diagonal = side * sqrt(2)

      const diamondSize = Math.max(minDiamondSize, Math.min(maxDiamondSize, diamondSide + 20))
      const height = Math.max(diamondSize, textDim.height + paddingY * 2)

      // For tall diamonds, make them wider
      const aspectRatio = height / diamondSize
      const width = aspectRatio > 1.3
        ? diamondSize * 1.3 // Widen when very tall
        : diamondSize

      return { width, height }
    }

    case 'io': {
      // Parallelogram: slanted edges reduce effective width
      const skewReduction = 20 // Space lost due to skew

      const preferredWidth = textDim.width + paddingX * 2 + skewReduction
      const width = Math.max(minWidth, Math.min(maxWidth, preferredWidth))
      const height = Math.max(48, textDim.height + paddingY * 2)

      return { width, height }
    }

    case 'start':
    case 'end': {
      // Rounded pills
      const preferredWidth = textDim.width + paddingX * 2 + 16
      const width = Math.max(minWidth, Math.min(maxWidth, preferredWidth))
      const height = Math.max(48, textDim.height + paddingY * 2)

      return { width, height }
    }

    case 'process':
    default: {
      // Rectangle
      const preferredWidth = textDim.width + paddingX * 2
      const width = Math.max(minWidth, Math.min(maxWidth, preferredWidth))
      const height = Math.max(48, textDim.height + paddingY * 2)

      // If height is excessive, widen the node
      if (height > 100) {
        const extraWidth = Math.min((height - 100) * 0.5, 60)
        return { width: Math.min(width + extraWidth, maxWidth), height }
      }

      return { width, height }
    }
  }
}
