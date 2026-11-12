'use strict';

/* =========================================================
   Plata statement PDF importer.
   Reads the transaction table from Plata credit-card statements
   using PDF.js (bundled in vendor/pdfjs).

   Plata has used two layouts:
   - Old (2025):  "30 abr 2025  1 may 2025  DOMINOS PIZZA  MXN 1.00  -$696.00"
                  purchases are "-", credits (cashback) have no sign
   - New (2026):  "12-oct-2026 13-oct-2026 OXXO SMART + 34.00 MXN 1.00 + $34.00"
                  purchases are "+", payments/credits are "−"
   Card payments ("Pago por transferencia SPEI") are skipped: paying the
   card isn't income, and the purchases are already counted.
   ========================================================= */

const PDFImport = (() => {

  // PDF.js (Mozilla, Apache-2.0) is bundled in vendor/pdfjs so it works offline.
  // It's only loaded the first time someone picks a PDF.
  const PDFJS_URL = new URL('vendor/pdfjs/pdf.min.mjs', document.baseURI).href;
  const WORKER_URL = new URL('vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;

  let _pdfjs = null;

  async function loadPDFJS() {
    if (_pdfjs) return _pdfjs;
    try {
      const lib = await import(PDFJS_URL);
      lib.GlobalWorkerOptions.workerSrc = WORKER_URL;
      _pdfjs = lib;
      return lib;
    } catch {
      throw new Error('Could not load the PDF reader. Close and reopen the app, then try again.');
    }
  }

  /* ---------- Auto-categorization ---------- */
  // Checked in order; the first category with a matching word wins.

  const EXPENSE_CATS = {
    Food: [
      'oxxo', 'walmart', 'superama', 'chedraui', 'soriana', 'bodega aurrera', 'aurrera',
      'restaurante', 'rest ', 'taqueria', 'tacos', 'uber eats', 'ubereats', 'rappi', 'didi food',
      'starbucks', 'cafe', 'coffee', 'cinnabon', 'haagen', 'boba', 'sushi', 'daisuki', 'fogon',
      "mcdonald", 'dominos', "domino's", 'pizza', 'burger', 'kfc', 'subway', 'fastfood', 'food',
      'fruterra', 'supermercado', 'panaderia', 'tortilleria', 'carniceria',
      'costco', "sam's", 'sams club', 'la comer', 'city market', 'heb ',
    ],
    Nightlife: [
      'antro', 'club', 'bar ', 'cantina', 'mezcal', 'cerveceria', 'pub ', 'lounge', 'disco', 'cover',
    ],
    Technology: [
      'apple store', 'istore', 'best buy', 'steren', 'cyberpuerta', 'ddtech', 'intercompras',
      'samsung', 'xiaomi', 'mac store', 'radioshack', 'telcel tienda',
    ],
    Transport: [
      'uber', 'cabify', 'didi', 'gasolina', 'gasolinera', 'pemex', 'shell', 'mobil', 'bp ', 'g500', 'oxxo gas',
      'estacion', 'metrobus', 'autobus', 'peaje', 'caseta', 'autopista', 'autolavado',
      'estacionamiento', 'parking', 'ado ', 'primera plus', 'etn ',
    ],
    Health: [
      'farmacia', 'far guad', 'benavides', 'san pablo', 'similares', 'doctor', 'hospital',
      'clinica', 'medico', 'laboratorio', 'dentista', 'gimnasio', 'gym', 'smart fit',
    ],
    Fun: [
      'netflix', 'spotify', 'cinemex', 'cinepolis', 'cinema', 'steam', 'playstation', 'nintendo',
      'xbox', 'disney', 'hbo', 'max ', 'prime video', 'youtube', 'twitch', 'ticketmaster',
    ],
    Bills: [
      'telcel', 'telmex', 'izzi', 'totalplay', 'megacable', 'at&t', 'movistar', 'bait ',
      'cfe', 'comision federal', 'gas natural', 'renta', 'seguro', 'suscripcion',
      'chatgpt', 'openai', 'google', 'apple.com', 'icloud', 'microsoft',
    ],
    School: [
      'escuela', 'colegio', 'universidad', 'tecnologico de monterrey', 'itesm', 'unam',
      'colegiatura', 'curso', 'libreria', 'gandhi', 'papeleria',
    ],
    Shopping: [
      'amazon', 'mercado libre', 'mercadolibre', 'liverpool', 'zara', 'h&m', 'shein', 'temu',
      'palacio de hierro', 'sears', 'coppel', 'elektra', 'office depot', 'sanborns', 'mixup', 'suburbia', 'walmart.com',
    ],
  };

  function categorize(description) {
    const lower = ` ${(description || '').toLowerCase()} `;
    for (const [cat, words] of Object.entries(EXPENSE_CATS)) {
      if (words.some((w) => lower.includes(w))) return cat;
    }
    return 'Other';
  }

  /* ---------- PDF text extraction ---------- */

  async function extractLines(file) {
    const pdfjs = await loadPDFJS();
    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch {
      throw new Error('Could not read that file.');
    }

    let pdf;
    try {
      pdf = await pdfjs.getDocument({ data: buffer }).promise;
    } catch (err) {
      if (err?.name === 'PasswordException') throw new Error('This PDF is password-protected. Unlock it first.');
      throw new Error('That file is not a valid PDF.');
    }

    const allLines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();

      // Rebuild table rows: text pieces whose heights are within 3 points are one row
      const items = content.items
        .filter((it) => it.str && it.str.trim())
        .map((it) => ({ x: it.transform[4], y: it.transform[5], text: it.str }))
        .sort((a, b) => b.y - a.y || a.x - b.x);

      const rows = [];
      for (const it of items) {
        const row = rows[rows.length - 1];
        if (row && Math.abs(row.y - it.y) <= 3) row.items.push(it);
        else rows.push({ y: it.y, items: [it] });
      }
      for (const row of rows) {
        allLines.push(row.items.sort((a, b) => a.x - b.x).map((i) => i.text).join(' ').replace(/\s+/g, ' ').trim());
      }
    }
    return allLines;
  }

  /* ---------- Transaction parsing ---------- */

  const MONTHS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };

  // "30 abr 2025", "12-oct-2026", "30/04/2025"
  const DATE = String.raw`(\d{1,2}[ \-][A-Za-z]{3}\.?[ \-]\d{4}|\d{1,2}\/\d{1,2}\/\d{4})`;
  const SIGN = String.raw`([+\-−–])?`;
  const MONEY = String.raw`\$?\s*([\d,]+\.\d{2})`;
  // date  date  description  [sign amount]  CUR  rate  [sign] $amount
  const ROW_RE = new RegExp(
    String.raw`^${DATE}\s+${DATE}\s+(.+?)\s+(?:[+\-−–]\s*[\d,]+\.\d{2}\s+)?([A-Z]{3})\s+[\d.,]+\s+${SIGN}\s*${MONEY}$`
  );

  function parseDate(str) {
    let m = str.match(/^(\d{1,2})[ \-]([A-Za-z]{3})\.?[ \-](\d{4})$/);
    if (m) {
      const mon = MONTHS[m[2].toLowerCase()];
      if (!mon) return null;
      return `${m[3]}-${String(mon).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  }

  const PAYMENT_RE = /\bpago\b|spei|transferencia|abono a (tu )?tarjeta|deposito/i;

  function parseLines(lines) {
    const rows = [];
    for (const line of lines) {
      const m = line.match(ROW_RE);
      if (!m) continue;
      const date = parseDate(m[1]);
      const amount = Math.round(parseFloat(m[6].replace(/,/g, '')) * 100) / 100;
      if (!date || !(amount > 0)) continue;
      rows.push({ date, description: m[3].trim(), sign: m[5] === '+' ? '+' : m[5] ? '-' : '' });
      rows[rows.length - 1].amount = amount;
    }

    // Which layout? New statements mark purchases with "+".
    const plusMeansCharge = rows.some((r) => r.sign === '+');

    const entries = [];
    let payments = 0;
    for (const r of rows) {
      const isCharge = plusMeansCharge ? r.sign === '+' : r.sign === '-';
      if (isCharge) {
        entries.push({ date: r.date, description: r.description, amount: r.amount, type: 'expense', category: categorize(r.description), note: r.description.slice(0, 100) });
      } else if (PAYMENT_RE.test(r.description)) {
        payments++; // paying off the card: not income
      } else {
        // cashback, refunds
        entries.push({ date: r.date, description: r.description, amount: r.amount, type: 'income', category: 'Other', note: r.description.slice(0, 100) });
      }
    }
    return { entries, payments };
  }

  /* ---------- Public API ---------- */

  async function parse(file) {
    const lines = await extractLines(file);
    const result = parseLines(lines);
    if (result.entries.length === 0 && result.payments === 0) {
      throw new Error('No transactions found. Make sure it is a Plata statement that has movements in it.');
    }
    return result;
  }

  return { parse, _parseLines: parseLines };
})();
