export function optionalAutomationCatchUpDate(value) {
  if (value === undefined || value === null || value === false || value === 0 || String(value).trim() === "")
    return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
