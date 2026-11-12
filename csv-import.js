'use strict';

/* =========================================================
   Bank CSV importer — parses Plata and common Mexican bank
   statement exports into Life Dashboard entries.
   ========================================================= */

const BankImport = (() => {

  /* ---------- Auto-categorization keyword map ---------- */

  const EXPENSE_CATS = {
    Food: [
      'oxxo', 'walmart', 'superama', 'chedraui', 'soriana', 'bodega aurrera', 'bodega', 'aurrera',
      'restaurante', 'taqueria', 'taquero', 'uber eats', 'ubereats', 'rappi', 'starbucks', 'cafe ',
      "mcdonald's", 'mcdonalds', "domino's", 'dominos', 'pizza', 'burger king', 'kfc', 'subway',
      'sushi', 'supermercado', 'panaderia', 'tortilleria', 'carneceria', 'frutas', 'verduras',
      'costco', "sam's", 'sams', 'la comer', 'lacomer', 'city market', 'alimentos', 'comida',
    ],
    Transport: [
      'uber', 'cabify', 'didi', 'gasolina', 'pemex', ' bp ', 'mobil', 'shell', 'gulf',
      'metro ', 'metrobus', 'autobus', 'autobu', 'camion', 'peaje', 'caseta', 'autopista',
      'estacionamiento', 'parking', 'scooter', 'bici', 'ecobici', 'ado', 'primera plus',
    ],
    Shopping: [
      'amazon', 'mercado libre', 'mercadolibre', 'liverpool', 'zara', 'h&m', 'shein',
      'palacio de hierro', 'sears', 'coppel', 'elektra', 'office depot', 'best buy', 'bestbuy',
      'apple store', 'fnac', 'mixup', 'sanborns',
    ],
    Bills: [
      'telcel', 'telmex', 'izzi', 'totalplay', 'megacable', 'axtel', 'at&t', 'movistar',
      'cfe ', 'comision federal', 'luz ', 'gas natural', 'gasnatural', 'gas lp', 'agua ',
      'predial', 'renta', 'hipoteca', 'seguro', 'infonavit', 'suscripcion', 'subscripcion',
    ],
    Health: [
      'farmacia', 'benavides', 'san pablo', 'guadalajara', 'doctor', 'hospital', 'clinica',
      'medico', 'laboratorio', 'dentista', 'optica', 'gimnasio', 'gym', 'smart fit', 'sports world',
    ],
    Fun: [
      'netflix', 'spotify', 'cinemex', 'cinepolis', 'cinema', 'steam', 'playstation', 'xbox',
      'disney', 'hbo', 'prime video', 'youtube premium', 'twitch', 'videojuego', 'teatro',
      'concierto', 'ticketmaster',
    ],
    School: [
      'escuela', 'colegio', 'universidad', 'tecnologico', 'tec de monterrey', 'unam', 'preparatoria',
      'prepa', 'kinder', 'colegiatura', 'curso', 'libreria', 'gandhi', 'el sotano',
    ],
  };

  const INCOME_CATS = {
    Job:       ['nomina', 'sueldo', 'salario', 'deposito nomina', 'honorarios'],
    Allowance: ['mesada', 'beca', 'apoyo', 'subsidio'],
    Gift:      ['regalo', 'prestamo'],
  };

  function categorize(description, type) {
    const lower = (description || '').toLowerCase();
    const map = type === 'expense' ? EXPENSE_CATS : INCOME_CATS;
    for (const [cat, words] of Object.entries(map)) {
      if (words.some((w) => lower.includes(w))) return cat;
    }
    return 'Other';
  }

  /* ---------- CSV parsing ---------- */

  function detectDelimiter(firstLine) {
    const semis = (firstLine.match(/;/g) || []).length;
    const commas = (firstLine.match(/,/g) || []).length;
    return semis > commas ? ';' : ',';
  }

  function splitLine(line, delimiter) {
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === delimiter && !inQ) { cols.push(cur.trim().replace(/^"|"$/g, '')); cur = ''; }
      else { cur += c; }
    }
    cols.push(cur.trim().replace(/^"|"$/g, ''));
    return cols;
  }

  function normalizeHeader(h) {
    return h.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
      .replace(/[^a-z0-9]/g, '');                        // keep alphanumeric
  }

  function findCol(headers, candidates) {
    const nh = headers.map(normalizeHeader);
    for (const c of candidates) {
      const idx = nh.findIndex((h) => h.includes(c));
      if (idx >= 0) return idx;
    }
    return -1;
  }

  /* ---------- Value parsing ---------- */

  function parseDate(str) {
    if (!str) return null;
    str = str.trim().replace(/"/g, '');
    // YYYY-MM-DD (with optional time)
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
    // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    const m = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    // Last resort: native parser
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return null;
  }

  function parseAmount(str) {
    if (str === '' || str == null) return 0;
    str = String(str).trim().replace(/[$\s€£]/g, '');
    // Parentheses = negative: (123.45)
    const negative = str.startsWith('(') && str.endsWith(')');
    str = str.replace(/[()]/g, '');
    const lastComma = str.lastIndexOf(',');
    const lastDot   = str.lastIndexOf('.');
    if (lastComma > lastDot) {
      // European format: 1.234,56
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // US / Mexican: 1,234.56
      str = str.replace(/,/g, '');
    }
    const val = parseFloat(str) || 0;
    return negative ? -Math.abs(val) : val;
  }

  /* ---------- Main parse function ---------- */

  /**
   * Parse a CSV text exported from a bank statement.
   * Returns { entries: [{date, description, amount, type, category, note}], skipped }
   * Throws an Error with a user-friendly message on bad input.
   */
  function parse(csvText) {
    const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n').filter(Boolean);
    if (lines.length < 2) throw new Error('El archivo parece estar vacío.');

    const delimiter = detectDelimiter(lines[0]);
    const rawHeaders = splitLine(lines[0], delimiter);
    const headers = rawHeaders.map(normalizeHeader);

    const dateIdx   = findCol(headers, ['fecha', 'date', 'dia', 'fec']);
    const descIdx   = findCol(headers, ['descripcion', 'concepto', 'detalle', 'comercio', 'desc', 'concept', 'detail', 'merchant', 'referencia', 'establecimiento']);
    const amountIdx = findCol(headers, ['monto', 'importe', 'amount', 'valor', 'total']);
    const cargoIdx  = findCol(headers, ['cargo', 'debito', 'debit', 'egreso', 'retiro']);
    const abonoIdx  = findCol(headers, ['abono', 'credito', 'credit', 'ingreso', 'deposito']);

    if (dateIdx < 0)
      throw new Error('No se encontró columna de fecha. Asegúrate de exportar el estado de cuenta completo desde Plata.');
    if (descIdx < 0 && amountIdx < 0 && cargoIdx < 0)
      throw new Error('No se pudo leer el formato del archivo. Intenta exportarlo de nuevo desde la app de Plata.');

    const entries = [];
    let skipped = 0;

    for (const line of lines.slice(1)) {
      const row = splitLine(line, delimiter);
      const date = parseDate(row[dateIdx]);
      if (!date) { skipped++; continue; }

      const desc = descIdx >= 0 ? (row[descIdx] || '').trim() : '';
      let amount, type;

      if (cargoIdx >= 0 || abonoIdx >= 0) {
        const cargo = cargoIdx >= 0 ? parseAmount(row[cargoIdx]) : 0;
        const abono = abonoIdx >= 0 ? parseAmount(row[abonoIdx]) : 0;
        if (cargo > 0)      { amount = cargo; type = 'expense'; }
        else if (abono > 0) { amount = abono; type = 'income'; }
        else                { skipped++; continue; }
      } else if (amountIdx >= 0) {
        const raw = parseAmount(row[amountIdx]);
        if (raw === 0) { skipped++; continue; }
        amount = Math.abs(raw);
        type   = raw < 0 ? 'expense' : 'income';
      } else {
        skipped++;
        continue;
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

    if (entries.length === 0)
      throw new Error('No se encontraron transacciones en el archivo. Verifica que sea un estado de cuenta de Plata.');

    return { entries, skipped };
  }

  return { parse };
})();
