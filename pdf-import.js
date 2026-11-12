'use strict';

/* =========================================================
   Bank PDF importer — extracts transactions from Plata and
   common Mexican bank statement PDFs using PDF.js.
   ========================================================= */

const PDFImport = (() => {

  const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.mjs';
  const WORKER_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.mjs';

  let _pdfjs = null;

  async function loadPDFJS() {
    if (_pdfjs) return _pdfjs;
    try {
      const lib = await import(PDFJS_CDN);
      lib.GlobalWorkerOptions.workerSrc = WORKER_CDN;
      _pdfjs = lib;
      return lib;
    } catch {
      throw new Error('No se pudo cargar el lector de PDF. Verifica tu conexión a internet e intenta de nuevo.');
    }
  }

  /* ---------- Auto-categorization ---------- */

  const EXPENSE_CATS = {
    Food: [
      'oxxo', 'walmart', 'superama', 'chedraui', 'soriana', 'bodega aurrera', 'bodega', 'aurrera',
      'restaurante', 'taqueria', 'uber eats', 'ubereats', 'rappi', 'starbucks', 'cafe ',
      "mcdonald's", 'mcdonalds', "domino's", 'dominos', 'pizza', 'burger king', 'kfc', 'subway',
      'sushi', 'supermercado', 'panaderia', 'tortilleria', 'carneceria',
      'costco', "sam's", 'sams', 'la comer', 'lacomer', 'city market',
    ],
    Transport: [
      'uber ', 'cabify', 'didi', 'gasolina', 'pemex', ' bp ', 'mobil', 'shell',
      'metro ', 'metrobus', 'autobus', 'peaje', 'caseta', 'autopista',
      'estacionamiento', 'parking', 'scooter', 'ecobici', 'ado ', 'primera plus',
    ],
    Shopping: [
      'amazon', 'mercado libre', 'mercadolibre', 'liverpool', 'zara', 'h&m', 'shein',
      'palacio de hierro', 'sears', 'coppel', 'elektra', 'office depot', 'best buy',
      'apple store', 'sanborns', 'mixup',
    ],
    Bills: [
      'telcel', 'telmex', 'izzi', 'totalplay', 'megacable', 'axtel', 'at&t', 'movistar',
      'cfe ', 'comision federal', 'luz ', 'gas natural', 'gasnatural',
      'predial', 'renta ', 'hipoteca', 'seguro', 'infonavit', 'suscripcion',
    ],
    Health: [
      'farmacia', 'benavides', 'san pablo', 'guadalajara', 'doctor', 'hospital',
      'clinica', 'medico', 'laboratorio', 'dentista', 'gimnasio', 'gym', 'smart fit',
    ],
    Fun: [
      'netflix', 'spotify', 'cinemex', 'cinepolis', 'cinema', 'steam', 'playstation',
      'xbox', 'disney', 'hbo ', 'prime video', 'youtube premium', 'twitch', 'ticketmaster',
    ],
    School: [
      'escuela', 'colegio', 'universidad', 'tecnologico', 'tec de monterrey', 'unam',
      'preparatoria', 'prepa', 'kinder', 'colegiatura', 'curso', 'libreria', 'gandhi',
    ],
  };

  const INCOME_CATS = {
    Job:       ['nomina', 'sueldo', 'salario', 'deposito nomina', 'honorarios'],
    Allowance: ['mesada', 'beca', 'apoyo', 'subsidio'],
    Gift:      ['regalo', 'prestamo', 'transferencia recibida'],
  };

  function categorize(description, type) {
    const lower = (description || '').toLowerCase();
    const map = type === 'expense' ? EXPENSE_CATS : INCOME_CATS;
    for (const [cat, words] of Object.entries(map)) {
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
      throw new Error('No se pudo leer el archivo PDF.');
    }

    let pdf;
    try {
      pdf = await pdfjs.getDocument({ data: buffer }).promise;
    } catch (err) {
      if (err?.message?.includes('password')) throw new Error('El PDF está protegido con contraseña. Desbloquéalo primero.');
      throw new Error('El archivo no es un PDF válido.');
    }

    const allLines = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();

      // Group text items by Y coordinate (2px buckets) to reconstruct rows
      const rows = new Map();
      for (const item of content.items) {
        const text = item.str;
        if (!text.trim()) continue;
        const y = Math.round(item.transform[5] / 2) * 2;
        const x = item.transform[4];
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push({ x, text });
      }

      // Sort rows top-to-bottom, items left-to-right
      const pageLines = [...rows.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.text).join(' '));

      allLines.push(...pageLines);
    }

    return allLines;
  }

  /* ---------- Transaction parsing ---------- */

  function parseDate(str) {
    // DD/MM/YYYY or DD-MM-YYYY
    const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  }

  function parseAmount(str) {
    return parseFloat(str.replace(/[$, ]/g, '')) || 0;
  }

  function parseLines(lines) {
    const entries = [];
    let skipped = 0;

    // Matches a date anywhere in a line: DD/MM/YYYY
    const DATE_RE = /\b(\d{2}\/\d{2}\/\d{4})\b/;
    // Matches currency amounts like 1,234.56 or 1234.56
    const AMOUNT_RE = /\$?\s*([\d]{1,3}(?:,\d{3})*\.\d{2})/g;
    // Negative indicator before an amount
    const NEG_RE = /[-−]\s*\$?\s*[\d,]+\.\d{2}/;

    for (const line of lines) {
      const dateMatch = line.match(DATE_RE);
      if (!dateMatch) continue;

      const date = parseDate(dateMatch[1]);
      if (!date) continue;

      const amountMatches = [...line.matchAll(AMOUNT_RE)];
      if (!amountMatches.length) { skipped++; continue; }

      const amounts = amountMatches.map((m) => parseAmount(m[1]));

      // Description: text between the date and the first amount
      const afterDate = line.slice(line.indexOf(dateMatch[1]) + dateMatch[1].length).trim();
      const firstAmtPos = afterDate.search(/\$?\s*[\d]{1,3}(?:,\d{3})*\.\d{2}/);
      const desc = (firstAmtPos > 0 ? afterDate.slice(0, firstAmtPos) : afterDate).trim();

      const lineLower = line.toLowerCase();
      const isNegative = NEG_RE.test(line);

      let amount, type;

      if (amounts.length === 1) {
        // Single amount: sign or keywords decide type
        amount = amounts[0];
        type = isNegative ? 'expense' : 'income';
      } else if (amounts.length === 2) {
        // Most common: amount + running balance
        amount = amounts[0];
        // Balance is usually larger; if amounts[1] > amounts[0] * 2 it's likely the balance
        if (isNegative || lineLower.includes('cargo') || lineLower.includes('compra') || lineLower.includes('pago')) {
          type = 'expense';
        } else if (lineLower.includes('abono') || lineLower.includes('deposito') || lineLower.includes('nomina')) {
          type = 'income';
        } else {
          // No clear signal: default expense (most transactions are expenses)
          type = 'expense';
        }
      } else {
        // 3+ amounts: likely cargo / abono / saldo columns
        // Check which columns have values vs zero/empty
        const cargo = amounts[0];
        const abono = amounts[1];
        if (cargo > 0 && abono === 0) { amount = cargo; type = 'expense'; }
        else if (abono > 0 && cargo === 0) { amount = abono; type = 'income'; }
        else { amount = amounts[0]; type = isNegative ? 'expense' : 'income'; }
      }

      amount = Math.round(amount * 100) / 100;
      if (!(amount > 0) || amount > 1e9) { skipped++; continue; }

      entries.push({
        date,
        description: desc,
        amount,
        type,
        category: categorize(desc, type),
        note: desc.slice(0, 100),
      });
    }

    return { entries, skipped };
  }

  /* ---------- Public API ---------- */

  async function parse(file) {
    const lines = await extractLines(file);
    const result = parseLines(lines);
    if (result.entries.length === 0) {
      throw new Error('No se encontraron transacciones. Asegúrate de que sea un estado de cuenta de Plata con movimientos.');
    }
    return result;
  }

  return { parse };
})();
