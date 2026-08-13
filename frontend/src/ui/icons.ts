const SVG_NS = 'http://www.w3.org/2000/svg';

export type IconName =
  | 'explore'
  | 'simulate'
  | 'inspect'
  | 'layers'
  | 'compare'
  | 'measure'
  | 'cityRuns'
  | 'rainfall'
  | 'terrain'
  | 'provenance'
  | 'download'
  | 'close'
  | 'chevron'
  | 'warning'
  | 'resetCamera'
  | 'fitAoi'
  | 'fitBuildings';

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

type Shape =
  | { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly r: number }
  | {
      readonly kind: 'line';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
    }
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly rx?: number;
    }
  | { readonly kind: 'polyline'; readonly points: string }
  | { readonly kind: 'polygon'; readonly points: string }
  | { readonly kind: 'path'; readonly d: string };

const ICON_SHAPES: Readonly<Record<IconName, readonly Shape[]>> = {
  explore: [
    { kind: 'circle', cx: 12, cy: 12, r: 9 },
    { kind: 'polygon', points: '12,7 14.5,12 12,17 9.5,12' },
  ],
  simulate: [
    { kind: 'circle', cx: 12, cy: 12, r: 2.5 },
    { kind: 'circle', cx: 12, cy: 12, r: 6.5 },
    { kind: 'circle', cx: 12, cy: 12, r: 10.5 },
  ],
  inspect: [
    { kind: 'circle', cx: 12, cy: 12, r: 6 },
    { kind: 'line', x1: 12, y1: 2, x2: 12, y2: 6 },
    { kind: 'line', x1: 12, y1: 18, x2: 12, y2: 22 },
    { kind: 'line', x1: 2, y1: 12, x2: 6, y2: 12 },
    { kind: 'line', x1: 18, y1: 12, x2: 22, y2: 12 },
  ],
  layers: [
    { kind: 'polygon', points: '12,3 21,8 12,13 3,8' },
    { kind: 'polyline', points: '3,13 12,18 21,13' },
    { kind: 'polyline', points: '3,17.5 12,22.5 21,17.5' },
  ],
  compare: [
    { kind: 'line', x1: 4, y1: 20, x2: 20, y2: 20 },
    { kind: 'rect', x: 6, y: 10, w: 3, h: 10 },
    { kind: 'rect', x: 11, y: 6, w: 3, h: 14 },
    { kind: 'rect', x: 16, y: 13, w: 3, h: 7 },
  ],
  measure: [
    { kind: 'polyline', points: '2,17 7,9 11,13 15,5 20,15' },
    { kind: 'line', x1: 2, y1: 20, x2: 22, y2: 20 },
  ],
  cityRuns: [
    { kind: 'rect', x: 3, y: 3, w: 7, h: 7, rx: 1 },
    { kind: 'rect', x: 14, y: 3, w: 7, h: 7, rx: 1 },
    { kind: 'rect', x: 3, y: 14, w: 7, h: 7, rx: 1 },
    { kind: 'rect', x: 14, y: 14, w: 7, h: 7, rx: 1 },
  ],
  terrain: [{ kind: 'polyline', points: '2,20 8,8 12,14 16,6 22,20' }],
  rainfall: [
    {
      kind: 'path',
      d: 'M12 2C12 2 6 9.6 6 13.6C6 17.05 8.69 19.8 12 19.8C15.31 19.8 18 17.05 18 13.6C18 9.6 12 2 12 2Z',
    },
  ],
  provenance: [
    { kind: 'circle', cx: 12, cy: 12, r: 9 },
    { kind: 'line', x1: 12, y1: 11, x2: 12, y2: 16 },
    { kind: 'line', x1: 12, y1: 7.5, x2: 12, y2: 7.5 },
  ],
  download: [
    { kind: 'line', x1: 12, y1: 3, x2: 12, y2: 15 },
    { kind: 'polyline', points: '7,10 12,15 17,10' },
    { kind: 'line', x1: 4, y1: 20, x2: 20, y2: 20 },
  ],
  close: [
    { kind: 'line', x1: 5, y1: 5, x2: 19, y2: 19 },
    { kind: 'line', x1: 19, y1: 5, x2: 5, y2: 19 },
  ],
  chevron: [{ kind: 'polyline', points: '6,9 12,15 18,9' }],
  warning: [
    { kind: 'polygon', points: '12,3 22,20 2,20' },
    { kind: 'line', x1: 12, y1: 10, x2: 12, y2: 15 },
    { kind: 'line', x1: 12, y1: 17.5, x2: 12, y2: 17.5 },
  ],
  resetCamera: [
    { kind: 'circle', cx: 12, cy: 12, r: 3 },
    { kind: 'path', d: 'M20 12a8 8 0 1 1-2.34-5.66' },
    { kind: 'polyline', points: '20,4 20,9 15,9' },
  ],
  fitAoi: [
    { kind: 'polyline', points: '3,9 3,3 9,3' },
    { kind: 'polyline', points: '15,3 21,3 21,9' },
    { kind: 'polyline', points: '21,15 21,21 15,21' },
    { kind: 'polyline', points: '9,21 3,21 3,15' },
  ],
  fitBuildings: [
    { kind: 'rect', x: 4, y: 10, w: 6, h: 10 },
    { kind: 'rect', x: 14, y: 5, w: 6, h: 15 },
  ],
};

function appendShape(svg: SVGSVGElement, shape: Shape): void {
  switch (shape.kind) {
    case 'circle':
      svg.appendChild(
        svgEl('circle', { cx: String(shape.cx), cy: String(shape.cy), r: String(shape.r) }),
      );
      return;
    case 'line':
      svg.appendChild(
        svgEl('line', {
          x1: String(shape.x1),
          y1: String(shape.y1),
          x2: String(shape.x2),
          y2: String(shape.y2),
        }),
      );
      return;
    case 'rect':
      svg.appendChild(
        svgEl('rect', {
          x: String(shape.x),
          y: String(shape.y),
          width: String(shape.w),
          height: String(shape.h),
          rx: String(shape.rx ?? 0),
        }),
      );
      return;
    case 'polyline':
      svg.appendChild(svgEl('polyline', { points: shape.points }));
      return;
    case 'polygon':
      svg.appendChild(svgEl('polygon', { points: shape.points }));
      return;
    case 'path':
      svg.appendChild(svgEl('path', { d: shape.d }));
      return;
  }
}

export function icon(name: IconName, size = 18): SVGSVGElement {
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24',
    width: String(size),
    height: String(size),
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.6',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: 'icon',
  });
  for (const shape of ICON_SHAPES[name]) {
    appendShape(svg, shape);
  }
  return svg;
}
