/**
 * Helper puro para generación de PDF oficial de Actas de Reunión (A4, márgenes 50 pt)
 * y payload de difusión por WhatsApp — Asociación Bello Horizonte.
 *
 * En Supabase Edge Functions (Deno) utiliza `pdf-lib` (`https://esm.sh/pdf-lib@1.17.1`).
 * Para pruebas unitarias en Node.js sin dependencias externas, incluye un generador
 * PDF 1.4 estándar (A4, Helvetica/Helvetica-Bold, WinAnsi, multipágina) con el mismo layout.
 */

export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;
export const PAGE_MARGIN = 50;
export const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN * 2;

export interface MinutePdfAgreement {
  descripcion: string;
  responsable: string;
  plazo: string;
}

export interface MinutePdfSignature {
  nombre: string;
  tipo: string;
  firmadoAt?: string | null;
}

export interface MinutePdfInput {
  groupName?: string | null;
  meetingTitle: string;
  meetingDate?: string | null;
  meetingPlace?: string | null;
  contenido: string;
  temasTratados?: string[];
  acuerdos?: MinutePdfAgreement[];
  presidenteNombre: string;
  presidenteAprobadoAt: string;
  secretarioNombre: string;
  secretarioAprobadoAt: string;
  signatures?: MinutePdfSignature[];
  hashSha256: string;
  estado?: string | null;
}

export interface MinuteWhatsAppShareInput {
  groupName?: string | null;
  meetingTitle: string;
  meetingDate?: string | null;
  meetingPlace?: string | null;
  acuerdos?: MinutePdfAgreement[];
  pdfUrl: string;
  hashSha256: string;
}

export interface MinuteWhatsAppSharePayload {
  whatsappText: string;
  whatsappShareUrl: string;
}

/**
 * Interfaz estructural compatible con `pdf-lib@1.17.1`.
 */
export interface PdfLibFont {
  widthOfTextAtSize(text: string, size: number): number;
}

export interface PdfLibPage {
  drawText(
    text: string,
    options: {
      x: number;
      y: number;
      size: number;
      font: PdfLibFont;
      color?: unknown;
    },
  ): void;
  drawLine(options: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    thickness?: number;
    color?: unknown;
  }): void;
  drawRectangle(options: {
    x: number;
    y: number;
    width: number;
    height: number;
    color?: unknown;
    borderColor?: unknown;
    borderWidth?: number;
  }): void;
}

export interface PdfLibDocument {
  embedFont(fontName: string): Promise<PdfLibFont>;
  addPage(size?: [number, number]): PdfLibPage;
  getPages(): PdfLibPage[];
  setTitle?(title: string): void;
  setAuthor?(author: string): void;
  setSubject?(subject: string): void;
  save(): Promise<Uint8Array>;
}

export interface PdfLibModule {
  PDFDocument: {
    create(): Promise<PdfLibDocument>;
  };
  StandardFonts: {
    Helvetica: string;
    HelveticaBold: string;
  };
  rgb: (red: number, green: number, blue: number) => unknown;
}

/**
 * Sanitiza texto para WinAnsi (Windows-1252) usado por `StandardFonts.Helvetica`.
 * Preserva español completo (`áéíóúñÁÉÍÓÚÑüÜ¿¡°ºª`) y evita crashes con emojis
 * o caracteres fuera del rango WinAnsi.
 */
export function sanitizeForWinAnsi(raw: string): string {
  const replaced = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '-')
    .replace(/\u00A0/g, ' ');

  let out = '';
  for (const ch of replaced) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      out += ch;
    }
  }
  return out;
}

export function formatDateEsPe(iso?: string | null): string {
  if (!iso || !iso.trim()) {
    return 'Fecha por confirmar';
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return sanitizeForWinAnsi(iso.trim());
  }
  try {
    return sanitizeForWinAnsi(
      new Intl.DateTimeFormat('es-PE', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'America/Lima',
      }).format(parsed),
    );
  } catch {
    return parsed.toISOString();
  }
}

/**
 * Divide un texto en líneas que caben en `maxWidth` usando la función `measureWidth`.
 * Respeta saltos de línea explícitos y corta tokens largos (ej. hashes SHA-256).
 */
export function wrapTextLines(
  text: string,
  maxWidth: number,
  measureWidth: (candidate: string) => number,
): string[] {
  const safe = sanitizeForWinAnsi(text);
  const paragraphs = safe.split('\n');
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }

    const words = trimmed.split(/\s+/);
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measureWidth(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
        current = '';
      }

      if (measureWidth(word) <= maxWidth) {
        current = word;
      } else {
        // Cortar token más ancho que la línea (p.ej. URL o hash SHA-256)
        let piece = '';
        for (const ch of word) {
          if (measureWidth(piece + ch) <= maxWidth) {
            piece += ch;
          } else {
            if (piece) lines.push(piece);
            piece = ch;
          }
        }
        current = piece;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines;
}

interface DrawInstruction {
  kind: 'text' | 'line' | 'rect';
  pageIndex: number;
  x: number;
  y: number;
  text?: string;
  size?: number;
  bold?: boolean;
  color?: [number, number, number];
  x2?: number;
  y2?: number;
  thickness?: number;
  width?: number;
  height?: number;
  fillColor?: [number, number, number];
  borderColor?: [number, number, number];
}

function buildMinuteLayout(
  input: MinutePdfInput,
  measureText: (text: string, size: number, bold: boolean) => number,
): { pageCount: number; instructions: DrawInstruction[] } {
  const instructions: DrawInstruction[] = [];
  let pageIndex = 0;
  let y = A4_HEIGHT - PAGE_MARGIN;
  const bottomLimit = PAGE_MARGIN + 24;

  const ensureSpace = (neededHeight: number) => {
    if (y - neededHeight < bottomLimit) {
      pageIndex += 1;
      y = A4_HEIGHT - PAGE_MARGIN;
    }
  };

  const addTextLine = (
    text: string,
    opts: {
      x?: number;
      size?: number;
      bold?: boolean;
      color?: [number, number, number];
      lineHeight?: number;
    } = {},
  ) => {
    const size = opts.size ?? 10;
    const lineHeight = opts.lineHeight ?? Math.round(size * 1.42);
    ensureSpace(lineHeight);
    const clean = sanitizeForWinAnsi(text);
    if (clean.length > 0) {
      instructions.push({
        kind: 'text',
        pageIndex,
        x: opts.x ?? PAGE_MARGIN,
        y,
        text: clean,
        size,
        bold: opts.bold ?? false,
        color: opts.color ?? [0.12, 0.14, 0.18],
      });
    }
    y -= lineHeight;
  };

  const addWrappedBlock = (
    text: string,
    opts: {
      x?: number;
      maxWidth?: number;
      size?: number;
      bold?: boolean;
      color?: [number, number, number];
      lineHeight?: number;
    } = {},
  ) => {
    const x = opts.x ?? PAGE_MARGIN;
    const maxWidth = opts.maxWidth ?? CONTENT_WIDTH - (x - PAGE_MARGIN);
    const size = opts.size ?? 10;
    const bold = opts.bold ?? false;
    const lines = wrapTextLines(text, maxWidth, (candidate) => measureText(candidate, size, bold));
    for (const line of lines) {
      if (line === '') {
        y -= Math.round(size * 0.7);
      } else {
        addTextLine(line, {
          x,
          size,
          bold,
          color: opts.color,
          lineHeight: opts.lineHeight,
        });
      }
    }
  };

  const addDivider = (color: [number, number, number] = [0.78, 0.82, 0.88]) => {
    ensureSpace(12);
    instructions.push({
      kind: 'line',
      pageIndex,
      x: PAGE_MARGIN,
      y: y + 4,
      x2: A4_WIDTH - PAGE_MARGIN,
      y2: y + 4,
      thickness: 0.8,
      color,
    });
    y -= 10;
  };

  const addSectionHeader = (title: string) => {
    ensureSpace(28);
    y -= 6;
    addTextLine(title, {
      size: 11,
      bold: true,
      color: [0.07, 0.24, 0.42],
      lineHeight: 16,
    });
    addDivider([0.07, 0.24, 0.42]);
  };

  const groupName = sanitizeForWinAnsi(input.groupName?.trim() || 'Asociación Bello Horizonte');
  const titleText = sanitizeForWinAnsi(input.meetingTitle.trim() || 'Reunión Vecinal');
  const dateText = formatDateEsPe(input.meetingDate);
  const placeText = sanitizeForWinAnsi(input.meetingPlace?.trim() || 'Local comunal / por precisar');
  const estadoText = sanitizeForWinAnsi((input.estado ?? 'aprobada').toUpperCase());

  // 1. Encabezado oficial
  instructions.push({
    kind: 'rect',
    pageIndex,
    x: PAGE_MARGIN,
    y: y - 34,
    width: CONTENT_WIDTH,
    height: 44,
    fillColor: [0.07, 0.24, 0.42],
  });
  instructions.push({
    kind: 'text',
    pageIndex,
    x: PAGE_MARGIN + 12,
    y: y - 10,
    text: `${groupName.toUpperCase()} — ACTA DE REUNIÓN`,
    size: 13,
    bold: true,
    color: [1, 1, 1],
  });
  instructions.push({
    kind: 'text',
    pageIndex,
    x: PAGE_MARGIN + 12,
    y: y - 26,
    text: 'DOCUMENTO OFICIAL PARA LIBRO DE ACTAS LEGALIZADO (PERÚ)',
    size: 8.5,
    bold: false,
    color: [0.85, 0.91, 0.98],
  });
  y -= 50;

  // 2. Datos de la reunión
  addWrappedBlock(`Sesión: ${titleText}`, { size: 11, bold: true, color: [0.08, 0.1, 0.15] });
  addTextLine(`Fecha y hora: ${dateText}`, { size: 9.5 });
  addTextLine(`Lugar: ${placeText}`, { size: 9.5 });
  addTextLine(`Estado del acta: ${estadoText}`, { size: 9.5 });
  addDivider();

  // 3. Texto completo del acta
  addSectionHeader('I. CONTENIDO DEL ACTA');
  addWrappedBlock(input.contenido || 'Sin contenido registrado.', {
    size: 10,
    lineHeight: 14.5,
  });

  // 4. Temas Tratados
  const temas = (input.temasTratados ?? []).map((t) => t.trim()).filter((t) => t.length > 0);
  if (temas.length > 0) {
    addSectionHeader('II. TEMAS TRATADOS');
    temas.forEach((tema, idx) => {
      addWrappedBlock(`${idx + 1}. ${tema}`, { size: 9.5, x: PAGE_MARGIN + 6, lineHeight: 13.5 });
    });
  }

  // 5. Acuerdos
  const acuerdos = (input.acuerdos ?? []).filter((a) => a.descripcion?.trim().length > 0);
  addSectionHeader('III. ACUERDOS ADOPTADOS');
  if (acuerdos.length === 0) {
    addTextLine('No se registraron acuerdos estructurados adicionales.', {
      size: 9.5,
      color: [0.35, 0.38, 0.44],
    });
  } else {
    acuerdos.forEach((acuerdo, idx) => {
      addWrappedBlock(`${idx + 1}. ${acuerdo.descripcion.trim()}`, {
        size: 9.5,
        bold: true,
        x: PAGE_MARGIN + 4,
        lineHeight: 13.5,
      });
      addWrappedBlock(
        `Responsable: ${acuerdo.responsable?.trim() || 'Junta Directiva'}  |  Plazo: ${
          acuerdo.plazo?.trim() || 'Por definir'
        }`,
        {
          size: 8.8,
          x: PAGE_MARGIN + 14,
          color: [0.28, 0.32, 0.38],
          lineHeight: 13,
        },
      );
      y -= 3;
    });
  }

  // 6. Bloque de Confirmación Directiva (Presidente + Secretario)
  addSectionHeader('IV. CONFIRMACIÓN DIRECTIVA (DOBLE VISTO BUENO)');
  ensureSpace(78);
  const colWidth = (CONTENT_WIDTH - 16) / 2;
  const boxHeight = 62;
  const boxBottomY = y - boxHeight + 10;

  // Caja Presidente
  instructions.push({
    kind: 'rect',
    pageIndex,
    x: PAGE_MARGIN,
    y: boxBottomY,
    width: colWidth,
    height: boxHeight,
    fillColor: [0.96, 0.98, 1],
    borderColor: [0.7, 0.78, 0.88],
  });
  instructions.push({
    kind: 'text',
    pageIndex,
    x: PAGE_MARGIN + 8,
    y: boxBottomY + boxHeight - 16,
    text: 'PRESIDENTE',
    size: 8.5,
    bold: true,
    color: [0.07, 0.24, 0.42],
  });
  instructions.push({
    kind: 'text',
    pageIndex,
    x: PAGE_MARGIN + 8,
    y: boxBottomY + boxHeight - 31,
    text: sanitizeForWinAnsi(input.presidenteNombre || 'Presidente de Directiva').slice(0, 38),
    size: 9.5,
    bold: true,
    color: [0.1, 0.12, 0.16],
  });
  instructions.push({
    kind: 'text',
    pageIndex,
    x: PAGE_MARGIN + 8,
    y: boxBottomY + boxHeight - 46,
    text: `Confirmado: ${formatDateEsPe(input.presidenteAprobadoAt)}`.slice(0, 46),
    size: 8,
    color: [0.3, 0.34, 0.4],
  });

  // Caja Secretario/a
  const rightX = PAGE_MARGIN + colWidth + 16;
  instructions.push({
    kind: 'rect',
    pageIndex,
    x: rightX,
    y: boxBottomY,
    width: colWidth,
    height: boxHeight,
    fillColor: [0.96, 0.98, 1],
    borderColor: [0.7, 0.78, 0.88],
  });
  instructions.push({
    kind: 'text',
    pageIndex,
    x: rightX + 8,
    y: boxBottomY + boxHeight - 16,
    text: 'SECRETARIO/A',
    size: 8.5,
    bold: true,
    color: [0.07, 0.24, 0.42],
  });
  instructions.push({
    kind: 'text',
    pageIndex,
    x: rightX + 8,
    y: boxBottomY + boxHeight - 31,
    text: sanitizeForWinAnsi(input.secretarioNombre || 'Secretario/a de Directiva').slice(0, 38),
    size: 9.5,
    bold: true,
    color: [0.1, 0.12, 0.16],
  });
  instructions.push({
    kind: 'text',
    pageIndex,
    x: rightX + 8,
    y: boxBottomY + boxHeight - 46,
    text: `Confirmado: ${formatDateEsPe(input.secretarioAprobadoAt)}`.slice(0, 46),
    size: 8,
    color: [0.3, 0.34, 0.4],
  });

  y = boxBottomY - 14;

  // 7. Cuadro de Conformidades Digitales y Código de Verificación SHA-256
  addSectionHeader('V. CONFORMIDADES DIGITALES Y VERIFICACIÓN SHA-256');
  const signatures = input.signatures ?? [];
  if (signatures.length === 0) {
    addTextLine('Conformidades registradas al momento de emisión: 0 (abierto para acuse de socios).', {
      size: 9,
      color: [0.32, 0.36, 0.42],
    });
  } else {
    addTextLine(`Conformidades digitales registradas (${signatures.length}):`, {
      size: 9.2,
      bold: true,
    });
    for (const sig of signatures.slice(0, 30)) {
      const tipoLabel = sig.tipo === 'conformidad_simple' ? 'Conformidad' : 'Acuse de recibo';
      const sigDate = sig.firmadoAt ? ` (${formatDateEsPe(sig.firmadoAt)})` : '';
      addWrappedBlock(`- ${sig.nombre} — ${tipoLabel}${sigDate}`, {
        size: 8.5,
        x: PAGE_MARGIN + 6,
        lineHeight: 12,
      });
    }
  }

  y -= 6;
  ensureSpace(48);
  const hashBoxHeight = 42;
  const hashBoxY = y - hashBoxHeight + 10;
  instructions.push({
    kind: 'rect',
    pageIndex,
    x: PAGE_MARGIN,
    y: hashBoxY,
    width: CONTENT_WIDTH,
    height: hashBoxHeight,
    fillColor: [0.95, 0.96, 0.97],
    borderColor: [0.75, 0.78, 0.82],
  });
  instructions.push({
    kind: 'text',
    pageIndex,
    x: PAGE_MARGIN + 8,
    y: hashBoxY + hashBoxHeight - 14,
    text: 'CÓDIGO DE VERIFICACIÓN DE INTEGRIDAD (SHA-256):',
    size: 8,
    bold: true,
    color: [0.15, 0.18, 0.24],
  });
  instructions.push({
    kind: 'text',
    pageIndex,
    x: PAGE_MARGIN + 8,
    y: hashBoxY + hashBoxHeight - 28,
    text: sanitizeForWinAnsi(input.hashSha256),
    size: 8.2,
    bold: false,
    color: [0.07, 0.24, 0.42],
  });

  const totalPages = pageIndex + 1;
  for (let p = 0; p < totalPages; p += 1) {
    instructions.push({
      kind: 'text',
      pageIndex: p,
      x: PAGE_MARGIN,
      y: 26,
      text: `${groupName} — Respaldo digital de acta (SHA-256: ${input.hashSha256.slice(0, 12)})`,
      size: 7.5,
      color: [0.45, 0.48, 0.54],
    });
    instructions.push({
      kind: 'text',
      pageIndex: p,
      x: A4_WIDTH - PAGE_MARGIN - 58,
      y: 26,
      text: `Página ${p + 1} de ${totalPages}`,
      size: 7.5,
      color: [0.45, 0.48, 0.54],
    });
  }

  return { pageCount: totalPages, instructions };
}

async function renderWithPdfLib(
  input: MinutePdfInput,
  pdfLib: PdfLibModule,
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = pdfLib;
  const pdfDoc = await PDFDocument.create();

  pdfDoc.setTitle?.(sanitizeForWinAnsi(`Acta — ${input.meetingTitle}`));
  pdfDoc.setAuthor?.(sanitizeForWinAnsi(input.groupName?.trim() || 'Asociación Bello Horizonte'));
  pdfDoc.setSubject?.('Acta oficial de reunión vecinal');

  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const layout = buildMinuteLayout(input, (text, size, bold) =>
    (bold ? boldFont : regularFont).widthOfTextAtSize(text, size),
  );

  const pages: PdfLibPage[] = [];
  for (let i = 0; i < layout.pageCount; i += 1) {
    pages.push(pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]));
  }

  for (const instr of layout.instructions) {
    const page = pages[instr.pageIndex];
    if (!page) continue;

    if (instr.kind === 'rect') {
      page.drawRectangle({
        x: instr.x,
        y: instr.y,
        width: instr.width ?? 0,
        height: instr.height ?? 0,
        color: instr.fillColor ? rgb(...instr.fillColor) : undefined,
        borderColor: instr.borderColor ? rgb(...instr.borderColor) : undefined,
        borderWidth: instr.borderColor ? 0.8 : undefined,
      });
    } else if (instr.kind === 'line') {
      page.drawLine({
        start: { x: instr.x, y: instr.y },
        end: { x: instr.x2 ?? instr.x, y: instr.y2 ?? instr.y },
        thickness: instr.thickness ?? 0.8,
        color: instr.color ? rgb(...instr.color) : rgb(0.7, 0.7, 0.7),
      });
    } else if (instr.kind === 'text' && instr.text) {
      page.drawText(instr.text, {
        x: instr.x,
        y: instr.y,
        size: instr.size ?? 10,
        font: instr.bold ? boldFont : regularFont,
        color: instr.color ? rgb(...instr.color) : rgb(0.12, 0.14, 0.18),
      });
    }
  }

  return await pdfDoc.save();
}

function encodeWinAnsiPdfLiteral(text: string): string {
  const safe = sanitizeForWinAnsi(text);
  let out = '(';
  for (const ch of safe) {
    const code = ch.charCodeAt(0);
    if (ch === '\\' || ch === '(' || ch === ')') {
      out += `\\${ch}`;
    } else if (code >= 0x20 && code <= 0x7e) {
      out += ch;
    } else if (code >= 0xa0 && code <= 0xff) {
      out += `\\${code.toString(8).padStart(3, '0')}`;
    }
  }
  out += ')';
  return out;
}

/**
 * Generador PDF 1.4 puro sin dependencias externas (usado en pruebas Node.js
 * cuando no se inyecta `pdf-lib`). Produce un archivo `%PDF-1.4` válido A4 multipágina.
 */
function renderWithBuiltinPdf14(input: MinutePdfInput): Uint8Array {
  const layout = buildMinuteLayout(input, (text, size, bold) => {
    const avgCharWidth = size * (bold ? 0.56 : 0.52);
    return text.length * avgCharWidth;
  });

  const pageStreams: string[][] = Array.from({ length: layout.pageCount }, () => []);

  for (const instr of layout.instructions) {
    const cmds = pageStreams[instr.pageIndex];
    if (!cmds) continue;

    if (instr.kind === 'rect') {
      const w = (instr.width ?? 0).toFixed(2);
      const h = (instr.height ?? 0).toFixed(2);
      if (instr.fillColor) {
        cmds.push(`${instr.fillColor.map((c) => c.toFixed(3)).join(' ')} rg`);
      }
      if (instr.borderColor) {
        cmds.push(`${instr.borderColor.map((c) => c.toFixed(3)).join(' ')} RG 0.8 w`);
      }
      const op = instr.fillColor && instr.borderColor ? 'B' : instr.fillColor ? 'f' : 'S';
      cmds.push(`${instr.x.toFixed(2)} ${instr.y.toFixed(2)} ${w} ${h} re ${op}`);
    } else if (instr.kind === 'line') {
      const col = instr.color ?? [0.7, 0.7, 0.7];
      cmds.push(
        `${col.map((c) => c.toFixed(3)).join(' ')} RG ${(instr.thickness ?? 0.8).toFixed(2)} w ` +
          `${instr.x.toFixed(2)} ${instr.y.toFixed(2)} m ${(instr.x2 ?? instr.x).toFixed(2)} ${(instr.y2 ?? instr.y).toFixed(2)} l S`,
      );
    } else if (instr.kind === 'text' && instr.text) {
      const col = instr.color ?? [0.12, 0.14, 0.18];
      const fontRef = instr.bold ? '/F2' : '/F1';
      cmds.push(
        `BT ${col.map((c) => c.toFixed(3)).join(' ')} rg ${fontRef} ${(instr.size ?? 10).toFixed(2)} Tf ` +
          `1 0 0 1 ${instr.x.toFixed(2)} ${instr.y.toFixed(2)} Tm ${encodeWinAnsiPdfLiteral(instr.text)} Tj ET`,
      );
    }
  }

  // Objetos PDF:
  // 1: Catalog, 2: Pages, 3: Helvetica, 4: Helvetica-Bold
  // Por cada página i: obj (5 + 2*i) = Page, obj (6 + 2*i) = Content stream
  const objects: string[] = [];
  const pageObjNums: number[] = [];
  for (let i = 0; i < layout.pageCount; i += 1) {
    pageObjNums.push(5 + i * 2);
  }

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(
    `2 0 obj\n<< /Type /Pages /Count ${layout.pageCount} /Kids [${pageObjNums
      .map((n) => `${n} 0 R`)
      .join(' ')}] >>\nendobj\n`,
  );
  objects.push(
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
  );
  objects.push(
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n',
  );

  for (let i = 0; i < layout.pageCount; i += 1) {
    const pageNum = 5 + i * 2;
    const contentNum = pageNum + 1;
    const streamBody = pageStreams[i].join('\n') + '\n';
    objects.push(
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH} ${A4_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`,
    );
    objects.push(
      `${contentNum} 0 obj\n<< /Length ${streamBody.length} >>\nstream\n${streamBody}endstream\nendobj\n`,
    );
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

/**
 * Genera los bytes de un PDF oficial A4 del acta aprobada por Presidente y Secretario.
 * Usa `pdf-lib` cuando se provee `pdfLib` (o en runtime Deno), y el generador
 * PDF 1.4 interno como respaldo portable en pruebas locales sin dependencias npm.
 */
export async function buildOfficialMinutePdfBytes(
  input: MinutePdfInput,
  pdfLib?: PdfLibModule,
): Promise<Uint8Array> {
  if (pdfLib) {
    return await renderWithPdfLib(input, pdfLib);
  }

  if (typeof (globalThis as { Deno?: unknown }).Deno !== 'undefined') {
    const esmUrl = 'https://esm.sh/pdf-lib@1.17.1';
    const loaded = (await import(/* @vite-ignore */ esmUrl)) as unknown as PdfLibModule;
    return await renderWithPdfLib(input, loaded);
  }

  return renderWithBuiltinPdf14(input);
}

/**
 * Construye el texto formal y enlace `wa.me` para difundir el acta oficial por WhatsApp.
 */
export function buildMinuteWhatsAppSharePayload(
  input: MinuteWhatsAppShareInput,
): MinuteWhatsAppSharePayload {
  const groupName = input.groupName?.trim() || 'Asociación Bello Horizonte';
  const title = input.meetingTitle.trim() || 'Reunión Vecinal';
  const dateText = formatDateEsPe(input.meetingDate);
  const placeText = input.meetingPlace?.trim() || 'Por precisar';
  const acuerdos = (input.acuerdos ?? []).filter((a) => a.descripcion?.trim().length > 0);

  const lines: string[] = [
    `*ACTA OFICIAL — ${groupName.toUpperCase()}*`,
    `Reunión: ${title}`,
    `Fecha: ${dateText}`,
    `Lugar: ${placeText}`,
    '',
  ];

  if (acuerdos.length > 0) {
    lines.push('*Principales acuerdos:*');
    for (const [idx, acuerdo] of acuerdos.slice(0, 6).entries()) {
      const resp = acuerdo.responsable?.trim() || 'Directiva';
      const plazo = acuerdo.plazo?.trim() || 'Por definir';
      lines.push(`${idx + 1}. ${acuerdo.descripcion.trim()} (Resp.: ${resp}; Plazo: ${plazo})`);
    }
    lines.push('');
  }

  lines.push(`Descargar Acta Oficial (PDF):\n${input.pdfUrl}`);
  lines.push('');
  lines.push(`Verificación SHA-256:\n${input.hashSha256}`);

  const whatsappText = lines.join('\n');
  const whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(whatsappText)}`;

  return { whatsappText, whatsappShareUrl };
}
