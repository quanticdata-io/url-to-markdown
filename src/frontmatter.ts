/** Quotes a scalar for YAML when needed (double-quoted, JSON-compatible escaping). */
function yamlScalar(value: string | number): string {
  if (typeof value === 'number') return String(value);
  if (value === '' || /[:#\-?{}[\],&*!|>'"%@`\n\r\t]|^\s|\s$/.test(value) || /^(true|false|null|yes|no|on|off|~|\d[\d.e+-]*)$/i.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

/** Renders a YAML frontmatter block; undefined and empty values are left out. */
export function renderFrontmatter(fields: Record<string, string | number | undefined>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${yamlScalar(v as string | number)}`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}
