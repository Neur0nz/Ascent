import { GREEN, RED } from './constants';
import type { MatchRole } from '@/types/match';
import { sanitizeSvgMarkup } from '@/utils/sanitizeSvg';

export type CellState = {
  levels: number;
  worker: number;
};

const LEVEL_OPACITIES = [0.24, 0.48, 0.72];
const LEVEL_STROKE_OPACITY = 0.85;
const DOME_OPACITY = 0.82;

type RenderOptions = {
  playerZeroRole?: MatchRole;
  colors?: {
    green?: string;
    red?: string;
  };
};

export function renderCellSvg({ levels, worker }: CellState, options?: RenderOptions): string {
  const width = 240;
  const height = 240;
  const levelHeight = 40;
  const levelShrinkX = 30;

  const playerZeroRole = options?.playerZeroRole ?? 'creator';
  const greenColor = options?.colors?.green ?? GREEN;
  const redColor = options?.colors?.red ?? RED;
  const positiveIsGreen = playerZeroRole !== 'opponent';
  let workerFill: string | undefined;
  if (worker > 0) {
    workerFill = positiveIsGreen ? greenColor : redColor;
  } else if (worker < 0) {
    workerFill = positiveIsGreen ? redColor : greenColor;
  } else {
    workerFill = undefined;
  }
  const workerStyle = workerFill ? `style=\"fill: ${workerFill};\"` : '';

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xml:space="preserve">`;

  for (let l = 0; l < levels && l < 3; l += 1) {
    const xBeg = levelShrinkX * l;
    const xEnd = width - levelShrinkX * l;
    const yBeg = height - levelHeight * l;
    const yEnd = height - levelHeight * (l + 1);
    const opacity = LEVEL_OPACITIES[Math.min(l, LEVEL_OPACITIES.length - 1)];
    svg += `<polygon fill="currentColor" fill-opacity="${opacity}" stroke="currentColor" stroke-opacity="${LEVEL_STROKE_OPACITY}" stroke-width="4" stroke-linejoin="round" points="${xBeg},${yBeg} ${xBeg},${yEnd} ${xEnd},${yEnd} ${xEnd},${yBeg}"/>`;
  }

  if (levels === 4) {
    svg += `<path d="M 70 0 A 50 50, 0, 0 1, 170 0" fill="currentColor" fill-opacity="${DOME_OPACITY}" stroke="currentColor" stroke-opacity="${LEVEL_STROKE_OPACITY}" stroke-width="4" transform="translate(0 ${3 * levelHeight})"/>`;
  } else if (worker !== 0) {
    svg += `<g ${workerStyle} transform="translate(70 ${height - levels * levelHeight - 100})">`;
    if (Math.abs(worker) === 1) {
      svg +=
        '<path d="M66.403,29.362C68.181,18.711,60.798,10,50,10l0,0c-10.794,0-18.177,8.711-16.403,19.362l2.686,16.133 c1.068,6.393,7.24,11.621,13.718,11.621l0,0c6.481,0,12.649-5.229,13.714-11.621L66.403,29.362z"/>' +
        '<path d="M64.007,58.001c-3.76,3.535-8.736,5.781-14.007,5.781s-10.247-2.246-14.007-5.781l-19.668,6.557 C12.845,65.716,10,69.668,10,73.333V90h80V73.333c0-3.665-2.845-7.617-6.325-8.775L64.007,58.001z"/>';
    } else {
      svg +=
        '<path d="M83.675,64.558l-19.668-6.557c-3.76,3.535-8.736,5.781-14.007,5.781s-10.247-2.246-14.007-5.781l-19.668,6.557 C12.845,65.716,10,69.668,10,73.333V90h80V73.333C90,69.668,87.155,65.716,83.675,64.558z"/>' +
        '<path d="M76.328,50c-6.442-6.439-9.661-14.886-9.661-23.333h-0.029C66.862,17.282,59.87,10,50,10 c-9.863,0-16.855,7.282-16.638,16.667h-0.029c0,8.447-3.219,16.895-9.661,23.333l4.714,4.717c3.189-3.189,5.726-6.846,7.637-10.791 l0.26,1.569c1.068,6.394,7.24,11.622,13.718,11.622c6.481,0,12.649-5.228,13.714-11.622l0.264-1.572 c1.911,3.945,4.447,7.605,7.637,10.794L76.328,50z"/>';
    }
    svg += '</g>';
  }

  svg += '</svg>';
  return sanitizeSvgMarkup(svg);
}
