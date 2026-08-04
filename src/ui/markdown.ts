/** Conversor mínimo de Markdown a HTML para la pantalla de reglas in-game. */

function inline(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>');
}

export function mdToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let list = false;
  let table = false;
  const closeAll = () => {
    if (list) {
      out.push('</ul>');
      list = false;
    }
    if (table) {
      out.push('</table>');
      table = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*\|/.test(line)) {
      if (/^\s*\|[\s\-|:]+\|\s*$/.test(line)) continue; // separador de encabezado
      if (!table) {
        closeAll();
        out.push('<table>');
        table = true;
      }
      const cells = line.replace(/^\s*\||\|\s*$/g, '').split('|');
      out.push('<tr>' + cells.map((c) => `<td>${inline(c.trim())}</td>`).join('') + '</tr>');
      continue;
    }
    if (table) {
      out.push('</table>');
      table = false;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeAll();
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!list) {
        out.push('<ul>');
        list = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (!list) {
        out.push('<ul>');
        list = true;
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    if (line.trim() === '' || line.trim() === '---') {
      closeAll();
      continue;
    }
    closeAll();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeAll();
  return out.join('\n');
}
