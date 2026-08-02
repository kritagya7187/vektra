/** Pure display-formatting helpers — no API/Cesium/DOM dependency. */

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatTimestamp(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

export function formatNullableNumber(value: number | null, unit?: string): string {
  if (value === null) {
    return '—';
  }
  const rounded = Math.round(value * 100) / 100;
  return unit ? `${rounded} ${unit}` : String(rounded);
}

/** Real, exact physical conversion (K - 273.15) — not a fabricated value, just a unit change of the same real Landsat ST_B10 reading. */
export function kelvinToCelsius(kelvin: number): number {
  return kelvin - 273.15;
}

/** "316.02 K / 44.87 °C" — both units of the same one real value. */
export function formatKelvinWithCelsius(kelvin: number): string {
  const rounded = Math.round(kelvin * 100) / 100;
  const celsius = Math.round(kelvinToCelsius(kelvin) * 100) / 100;
  return `${rounded} K / ${celsius} °C`;
}

export function formatNullableText(value: string | null): string {
  return value === null || value.length === 0 ? '—' : value;
}

const FACTOR_KEY_LABELS: Record<string, string> = {
  thermal_signature: 'Thermal signature',
  vegetation_land_cover: 'Vegetation / land cover',
  morphology_density: 'Morphology / density',
  exposure_shading: 'Exposure / shading',
  meteorological_context: 'Meteorological context',
};

export function formatFactorKey(factorKey: string): string {
  return FACTOR_KEY_LABELS[factorKey] ?? factorKey;
}

const RUN_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

export function formatRunStatus(status: string): string {
  return RUN_STATUS_LABELS[status] ?? status;
}
