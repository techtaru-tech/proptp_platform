/** Shared categorical palette for Recharts — the TechTaru brand colours plus semantic tones. */
export const CHART_COLORS = {
  brand: '#00a3a3',
  accent: '#f97316',
  blossom: '#64b975',
  steel: '#428797',
  shell: '#525c6b',
  success: '#12b76a',
  info: '#2e90fa',
  warning: '#f79009',
  danger: '#f04438',
  violet: '#927ffd',
  slate: '#98a2b3',
};

/**
 * Ordered so neighbouring series never share a hue family: the teal primary, the saffron
 * secondary, then the logo's leaf green. Warning-orange and success-green are left out of the
 * series on purpose — they sit too close to saffron and leaf to tell apart in a legend.
 */
export const CHART_SERIES = [
  CHART_COLORS.brand,
  CHART_COLORS.accent,
  CHART_COLORS.blossom,
  CHART_COLORS.info,
  CHART_COLORS.violet,
  CHART_COLORS.shell,
];

export const GRID_STROKE = '#e4e7ec';
export const AXIS_TICK = { fill: '#667085', fontSize: 11 };
