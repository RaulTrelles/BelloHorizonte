import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  A4_HEIGHT,
  A4_WIDTH,
  buildMinuteWhatsAppSharePayload,
  buildOfficialMinutePdfBytes,
  type MinutePdfInput,
  type PdfLibModule,
  sanitizeForWinAnsi,
  wrapTextLines,
} from './minutePdf.ts';

const sampleHash = 'a3f5c8e1d9b240768591c4e2f0a8b7d6c5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0';

const baseInput: MinutePdfInput = {
  groupName: 'Asociación Bello Horizonte',
  meetingTitle: 'Asamblea Extraordinaria — Seguridad y Vigilancia',
  meetingDate: '2026-11-23T19:30:00-05:00',
  meetingPlace: 'Parque Central Bello Horizonte, Lima',
  contenido:
    'En la ciudad de Lima, siendo las 19:30 horas, se reunieron los vecinos y la Junta Directiva ' +
    'para revisar la instalación de cámaras en la esquina norte, el mantenimiento de la sirena vecinal ' +
    'y la rendición de cuentas del trimestre. Se aprobó por unanimidad el plan de acción 2026.',
  temasTratados: [
    'Instalación de cámaras de videovigilancia en esquina norte',
    'Mantenimiento preventivo de alarma comunitaria',
    'Rendición de cuentas del tercer trimestre',
  ],
  acuerdos: [
    {
      descripcion: 'Adquirir e instalar 2 cámaras IP con respaldo eléctrico',
      responsable: 'Comité de Seguridad',
      plazo: '15/12/2026',
    },
    {
      descripcion: 'Publicar el balance trimestral en el portal web de la asociación',
      responsable: 'Tesorería',
      plazo: '30/11/2026',
    },
  ],
  presidenteNombre: 'José Núñez Quispe',
  presidenteAprobadoAt: '2026-11-23T21:05:00-05:00',
  secretarioNombre: 'María Elena Peña Torres',
  secretarioAprobadoAt: '2026-11-23T21:10:00-05:00',
  signatures: [
    {
      nombre: 'Carlos Alberto Ríos',
      tipo: 'conformidad_simple',
      firmadoAt: '2026-11-23T21:20:00-05:00',
    },
    {
      nombre: 'Lucía Fernández',
      tipo: 'acuse_recibo',
      firmadoAt: '2026-11-23T21:25:00-05:00',
    },
  ],
  hashSha256: sampleHash,
  estado: 'aprobada',
};

describe('minutePdf — buildOfficialMinutePdfBytes', () => {
  it('genera un PDF real con cabecera %PDF- y tamaño > 1 KB soportando tildes y ñ', async () => {
    const bytes = await buildOfficialMinutePdfBytes(baseInput);
    assert.ok(bytes instanceof Uint8Array);
    assert.ok(bytes.byteLength > 1024, `Tamaño esperado > 1024 bytes, recibido ${bytes.byteLength}`);

    const header = new TextDecoder('latin1').decode(bytes.subarray(0, 5));
    assert.equal(header, '%PDF-');

    const fullText = new TextDecoder('latin1').decode(bytes);
    assert.match(fullText, /%%EOF/);
    assert.match(fullText, /MediaBox \[0 0 595\.28 841\.89\]/);
    assert.match(fullText, new RegExp(sampleHash));
  });

  it('salta automáticamente a múltiples páginas cuando el contenido del acta es extenso', async () => {
    const longParagraph =
      'Los vecinos intervinieron sobre la iluminación LED en los pasajes internos, la señalización ' +
      'de zonas seguras y la coordinación con Serenazgo y la Policía Nacional del Perú (105). ' +
      'Se dejó constancia expresa de las observaciones planteadas por los socios asistentes.';
    const multiPageContent = Array.from({ length: 35 }, (_, i) => `Párrafo ${i + 1}: ${longParagraph}`).join(
      '\n\n',
    );

    const bytes = await buildOfficialMinutePdfBytes({
      ...baseInput,
      contenido: multiPageContent,
    });

    assert.ok(bytes.byteLength > 4096, 'Un acta multipágina debe superar los 4 KB');
    const fullText = new TextDecoder('latin1').decode(bytes);
    const pageMatches = fullText.match(/\/Type \/Page\b/g) ?? [];
    assert.ok(
      pageMatches.length >= 2,
      `Se esperaban al menos 2 páginas PDF, se generaron ${pageMatches.length}`,
    );
  });

  it('invoca correctamente el motor pdf-lib cuando se inyecta (A4, StandardFonts, multipágina)', async () => {
    const addedPages: Array<[number, number]> = [];
    const drawnTexts: string[] = [];
    const embeddedFonts: string[] = [];

    const mockPdfLib: PdfLibModule = {
      StandardFonts: {
        Helvetica: 'Helvetica',
        HelveticaBold: 'Helvetica-Bold',
      },
      rgb: (r, g, b) => ({ r, g, b }),
      PDFDocument: {
        async create() {
          const pages: Array<ReturnType<PdfLibModule['PDFDocument']['create'] extends never ? never : () => never>> = [];
          return {
            async embedFont(fontName: string) {
              embeddedFonts.push(fontName);
              return {
                widthOfTextAtSize: (text: string, size: number) => text.length * size * 0.52,
              };
            },
            addPage(size?: [number, number]) {
              addedPages.push(size ?? [A4_WIDTH, A4_HEIGHT]);
              const page = {
                drawText(text: string) {
                  drawnTexts.push(text);
                },
                drawLine() {},
                drawRectangle() {},
              };
              pages.push(page as never);
              return page;
            },
            getPages() {
              return pages as never;
            },
            setTitle() {},
            setAuthor() {},
            setSubject() {},
            async save() {
              return new TextEncoder().encode('%PDF-1.7\n%mock-pdf-lib\n' + 'x'.repeat(1200) + '\n%%EOF');
            },
          };
        },
      },
    };

    const bytes = await buildOfficialMinutePdfBytes(
      {
        ...baseInput,
        contenido: `${baseInput.contenido} 🚀✨`,
      },
      mockPdfLib,
    );

    assert.deepEqual(embeddedFonts, ['Helvetica', 'Helvetica-Bold']);
    assert.ok(addedPages.length >= 1);
    assert.deepEqual(addedPages[0], [A4_WIDTH, A4_HEIGHT]);
    assert.ok(drawnTexts.some((t) => t.includes('ASOCIACIÓN BELLO HORIZONTE')));
    assert.ok(drawnTexts.some((t) => t.includes('José Núñez Quispe')));
    assert.ok(drawnTexts.some((t) => t.includes('María Elena Peña Torres')));
    assert.ok(drawnTexts.some((t) => t.includes(sampleHash)));
    assert.ok(
      drawnTexts.every((t) => !t.includes('🚀') && !t.includes('✨')),
      'No deben pasar emojis fuera de WinAnsi a StandardFonts.Helvetica',
    );
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), '%PDF-');
  });
});

describe('minutePdf — buildMinuteWhatsAppSharePayload y sanitización', () => {
  it('construye mensaje formal y URL wa.me con acuerdos, PDF y SHA-256', () => {
    const pdfUrl =
      'https://example.supabase.co/storage/v1/object/public/meeting-minutes-pdf/g1/m1/acta_a3f5c8e1d9b2.pdf';

    const { whatsappText, whatsappShareUrl } = buildMinuteWhatsAppSharePayload({
      groupName: 'Asociación Bello Horizonte',
      meetingTitle: baseInput.meetingTitle,
      meetingDate: baseInput.meetingDate,
      meetingPlace: baseInput.meetingPlace,
      acuerdos: baseInput.acuerdos,
      pdfUrl,
      hashSha256: sampleHash,
    });

    assert.match(whatsappText, /ACTA OFICIAL — ASOCIACIÓN BELLO HORIZONTE/);
    assert.match(whatsappText, /Adquirir e instalar 2 cámaras IP/);
    assert.match(whatsappText, /Comité de Seguridad/);
    assert.ok(whatsappText.includes(pdfUrl));
    assert.ok(whatsappText.includes(sampleHash));

    assert.ok(whatsappShareUrl.startsWith('https://wa.me/?text='));
    assert.equal(decodeURIComponent(whatsappShareUrl.replace('https://wa.me/?text=', '')), whatsappText);
  });

  it('sanitiza caracteres fuera de WinAnsi preservando tildes y ñ', () => {
    const clean = sanitizeForWinAnsi('Reunión vecinal — Señor Peña “año 2026” 🚨✅');
    assert.equal(clean, 'Reunión vecinal - Señor Peña "año 2026" ');
  });

  it('divide líneas largas respetando el ancho máximo', () => {
    const lines = wrapTextLines(
      'Uno dos tres cuatro cinco seis siete ocho',
      50,
      (s) => s.length * 5,
    );
    assert.ok(lines.length >= 3);
    assert.ok(lines.every((l) => l.length * 5 <= 50));
  });
});
