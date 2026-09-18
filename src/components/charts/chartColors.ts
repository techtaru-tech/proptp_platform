/** Shared categorical palette for Recharts — the Rosium brand colours plus semantic tones. */
export const CHART_COLORS = {
  brand: '#652251',
  accent: '#2596BE',
  blossom: '#D4166C',
  shell: '#80687b',
  success: '#12b76a',
  info: '#2e90fa',
  warning: '#f79009',
  danger: '#f04438',
  violet: '#927ffd',
  slate: '#98a2b3',
};

/**
 * Ordered so neighbouring series never share a hue family: the plum primary, the blue
 * secondary, then the logo's pink, which is far enough in lightness from the plum to stay
 * readable beside it.
 */
export const CHART_SERIES = [
  CHART_COLORS.brand,
  CHART_COLORS.accent,
  CHART_COLORS.blossom,
  CHART_COLORS.success,
  CHART_COLORS.warning,
  CHART_COLORS.violet,
];

export const GRID_STROKE = '#e4e7ec';
export const AXIS_TICK = { fill: '#667085', fontSize: 11 };
