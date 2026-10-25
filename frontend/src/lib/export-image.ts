import { toPng } from 'html-to-image';

/**
 * Precision flowchart exporter:
 * 1. Computes the exact bounding box of all nodes and arrows.
 * 2. Crops out empty canvas margins so the diagram is centered and tightly framed.
 * 3. Enforces high-DPI rendering (2x) and full CSS theme fidelity across both Light and Dark modes.
 * 4. Explicitly inlines SVG shape fills and strokes so the SVG data-URL sandbox cannot default SVG shapes to black.
 */
export async function exportGraphToPng(isDark: boolean, projectName: string): Promise<void> {
  const viewportElement = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  if (!viewportElement) {
    throw new Error('Область графа не найдена');
  }

  // Find all rendered nodes on canvas
  const nodeElements = Array.from(document.querySelectorAll('.react-flow__node')) as HTMLElement[];
  if (nodeElements.length === 0) {
    throw new Error('Узлы графа не найдены');
  }

  // Calculate actual bounds from rendered node positions and sizes
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodeElements.forEach((el) => {
    const transform = el.style.transform;
    const match = transform.match(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/);
    let x = 0;
    let y = 0;
    if (match) {
      x = parseFloat(match[1]);
      y = parseFloat(match[2]);
    } else {
      x = el.offsetLeft;
      y = el.offsetTop;
    }

    const w = el.offsetWidth || 360;
    const h = el.offsetHeight || 140;

    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  });

  // Generous padding around the diagram bounds
  const padding = 70;
  const imageWidth = Math.ceil((maxX - minX) + padding * 2);
  const imageHeight = Math.ceil((maxY - minY) + padding * 2);
  const translateX = Math.round(-minX + padding);
  const translateY = Math.round(-minY + padding);

  const timestamp = new Date().toISOString().slice(0, 10);
  const cleanProjectName = (projectName || 'JavaBlueprint').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${cleanProjectName}_${isDark ? 'dark' : 'light'}_flowchart_${timestamp}.png`;

  const theme = isDark ? 'dark' : 'light';
  const prevTheme = viewportElement.getAttribute('data-theme');
  viewportElement.setAttribute('data-theme', theme);

  // Directly set CSS custom properties on viewportElement to ensure cloned inheritance
  const themeProps = isDark
    ? {
      '--bg-main': '#0D1117',
      '--bg-canvas': '#080C12',
      '--bg-panel': '#161B22',
      '--border-color': '#30363D',
      '--text-primary': '#F0F6FC',
      '--text-secondary': '#8B949E',
      '--node-variable': '#A855F7',
      '--node-condition': '#F59E0B',
      '--node-loop': '#10B981',
      '--node-method': '#0EA5E9',
      '--node-operation': '#84CC16',
      '--node-return': '#F43F5E',
    }
    : {
      '--bg-main': '#F6F8FA',
      '--bg-canvas': '#F6F8FA',
      '--bg-panel': '#FFFFFF',
      '--border-color': '#D0D7DE',
      '--text-primary': '#1F2328',
      '--text-secondary': '#57606A',
      '--node-variable': '#9333EA',
      '--node-condition': '#D97706',
      '--node-loop': '#059669',
      '--node-method': '#0284C7',
      '--node-operation': '#65A30D',
      '--node-return': '#E11D48',
    };

  Object.entries(themeProps).forEach(([prop, val]) => {
    viewportElement.style.setProperty(prop, val);
  });

  // Ensure all node elements have data-theme attribute
  nodeElements.forEach((nodeEl) => {
    nodeEl.setAttribute('data-theme', theme);
  });

  // Explicitly set fill and stroke attributes on SVG shape elements
  // This prevents SVG-as-image data-URL sandboxes from falling back to SVG default black fill!
  const shapes = Array.from(viewportElement.querySelectorAll('svg rect, svg polygon, svg path')) as SVGGraphicsElement[];
  const originalSvgStyles = shapes.map((shape) => ({
    shape,
    fillAttr: shape.getAttribute('fill'),
    strokeAttr: shape.getAttribute('stroke'),
    fillCss: shape.style.fill,
    strokeCss: shape.style.stroke,
    strokeWidthCss: shape.style.strokeWidth,
  }));

  const shapeFill = isDark ? '#161B22' : '#FFFFFF';

  shapes.forEach((shape) => {
    const className = shape.getAttribute('class') || '';
    const parentClass = shape.parentElement?.getAttribute('class') || '';
    const isBackgroundShape = className.includes('shapePath') || parentClass.includes('shapeSvgBg');

    if (shape.classList.contains('react-flow__edge-path')) {
      const computed = window.getComputedStyle(shape);
      shape.style.stroke = computed.stroke;
      shape.style.strokeWidth = computed.strokeWidth;
      shape.style.fill = 'none';
      shape.setAttribute('stroke', computed.stroke);
      shape.setAttribute('fill', 'none');
    }
    if (isBackgroundShape) {
      const computed = window.getComputedStyle(shape);
      const stroke = computed.stroke && computed.stroke !== 'none' && computed.stroke !== 'rgba(0, 0, 0, 0)'
        ? computed.stroke
        : (isDark ? '#30363D' : '#D0D7DE');
      const fill = computed.fill && computed.fill !== 'none' && computed.fill !== 'rgba(0, 0, 0, 0)'
        ? computed.fill
        : shapeFill;

      shape.setAttribute('fill', fill);
      shape.setAttribute('stroke', stroke);
      shape.style.fill = fill;
      shape.style.stroke = stroke;
    }
  });

  try {
    const dataUrl = await toPng(viewportElement, {
      backgroundColor: isDark ? '#080C12' : '#F6F8FA',
      width: imageWidth,
      height: imageHeight,
      pixelRatio: 2,
      style: {
        width: `${imageWidth}px`,
        height: `${imageHeight}px`,
        transform: `translate(${translateX}px, ${translateY}px) scale(1)`,
        transformOrigin: '0 0',
        backgroundColor: isDark ? '#080C12' : '#F6F8FA',
        backgroundImage: isDark
          ? 'radial-gradient(circle, #2A3647 1.2px, transparent 1.2px)'
          : 'radial-gradient(circle, #CBD5E1 1.2px, transparent 1.2px)',
        backgroundSize: '20px 20px',
        colorScheme: isDark ? 'dark' : 'light',
      },
      filter: (node) => {
        if (node instanceof HTMLElement) {
          if (
            node.classList.contains('react-flow__attribution') ||
            node.classList.contains('react-flow__panel') ||
            node.classList.contains('react-flow__controls')
          ) {
            return false;
          }
        }
        return true;
      },
    });

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    // Clean up temporary DOM attributes and styles
    if (prevTheme) {
      viewportElement.setAttribute('data-theme', prevTheme);
    } else {
      viewportElement.removeAttribute('data-theme');
    }
    Object.keys(themeProps).forEach((prop) => {
      viewportElement.style.removeProperty(prop);
    });
    originalSvgStyles.forEach(({ shape, fillAttr, strokeAttr, fillCss, strokeCss, strokeWidthCss }) => {
      if (fillAttr !== null) shape.setAttribute('fill', fillAttr);
      else shape.removeAttribute('fill');

      if (strokeAttr !== null) shape.setAttribute('stroke', strokeAttr);
      else shape.removeAttribute('stroke');

      shape.style.fill = fillCss;
      shape.style.stroke = strokeCss;
      shape.style.strokeWidth = strokeWidthCss;
    });
  }
}
