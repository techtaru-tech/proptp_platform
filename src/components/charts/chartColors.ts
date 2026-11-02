/** Shared categorical palette for Recharts — the Propto brand colours plus semantic tones. */
export const CHART_COLORS = {
  brand: '#0e7f51',
  accent: '#d98e04',
  blossom: '#7ab32e',
  steel: '#2d6294',
  shell: '#4f6177',
  success: '#12b76a',
  info: '#2e90fa',
  warning: '#f79009',
  danger: '#f04438',
  violet: '#927ffd',
  slate: '#98a2b3',
};

/**
 * Ordered so neighbouring series never share a hue family: the green primary, the amber
 * secondary, then blue and violet before the logo's lime, which is kept well away from the
 * green. Warning-orange and success-green are left out of the series on purpose — they sit too
 * close to amber and the primary green to tell apart in a legend.
 */
export const CHART_SERIES = [
  CHART_COLORS.brand,
  CHART_COLORS.accent,
  CHART_COLORS.info,
  CHART_COLORS.violet,
  CHART_COLORS.blossom,
  CHART_COLORS.shell,
];

export const GRID_STROKE = '#e4e7ec';
export const AXIS_TICK = { fill: '#667085', fontSize: 11 };
