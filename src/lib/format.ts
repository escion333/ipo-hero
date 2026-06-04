export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}
