import { precipitationColor, precipitationIntensity } from '../domain/colormap';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DROPLET_PATH =
  'M12 2C12 2 5 11.2 5 15.8C5 19.78 8.13 23 12 23C15.87 23 19 19.78 19 15.8C19 11.2 12 2 12 2Z';
const MIN_SCALE = 0.42;
const MAX_SCALE = 1;
const MIN_OPACITY = 0.3;
const MAX_OPACITY = 0.95;

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

export function precipitationGlyph(options: {
  readonly totalMm: number;
  readonly maxTotalMm: number;
  readonly size?: number;
}): SVGSVGElement {
  const size = options.size ?? 22;
  const t = precipitationIntensity(options.totalMm, options.maxTotalMm);
  const scale = MIN_SCALE + (MAX_SCALE - MIN_SCALE) * t;
  const opacity = MIN_OPACITY + (MAX_OPACITY - MIN_OPACITY) * t;
  const [r, g, b] = precipitationColor(options.totalMm, options.maxTotalMm);
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24',
    width: String(size),
    height: String(size),
    class: 'precip-glyph',
  });
  const group = svgEl('g', {
    transform: `translate(12,13) scale(${scale}) translate(-12,-13)`,
  });
  group.appendChild(
    svgEl('path', {
      d: DROPLET_PATH,
      fill: `rgb(${r},${g},${b})`,
      'fill-opacity': String(opacity),
    }),
  );
  svg.appendChild(group);
  return svg;
}
