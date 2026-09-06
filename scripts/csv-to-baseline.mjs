#!/usr/bin/env node
// Turn the Supabase SQL editor's CSV download into migrations/000_baseline.sql.
//
//   node scripts/csv-to-baseline.mjs <downloaded.csv> [out.sql]
//
// The SQL editor returns EXPORT_SCHEMA.sql's output as rows and offers a CSV
// download. Most of those rows are multi-line — a CREATE TABLE or a function
// body — so the CSV quotes them, and a naive split on newlines shreds the
// file. This parses CSV properly: quoted fields, embedded newlines, and ""
// as an escaped quote.
//
// It sorts by the row number the export emits rather than trusting file order,
// because a spreadsheet in between (which is what "download CSV" invites) can
// reorder rows without anyone noticing. Getting the order wrong here means a
// foreign key referencing a table that does not exist yet, which fails loudly
// — but a policy landing before its table's RLS is enabled fails silently, and
// that is the one worth being careful about.

import { readFileSync, writeFileSync } from 'node:fs'

const [, , input, output = 'migrations/000_baseline.sql'] = process.argv
if (!input) {
  console.error('usage: node scripts/csv-to-baseline.mjs <downloaded.csv> [out.sql]')
  process.exit(2)
}

/** A CSV parser that handles quoted fields containing newlines and commas. */
function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  // A BOM at the head of a spreadsheet export becomes part of the first field
  // and then part of the first column name, so the header check silently fails.
  const s = text.replace(/^﻿/, '').replace(/\r\n/g, '\n')

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.length > 1 || (r[0] && r[0].trim()))
}

const rows = parseCsv(readFileSync(input, 'utf8'))
if (!rows.length) { console.error('The CSV is empty.'); process.exit(1) }

// The export selects `n` and `ddl`. Find them by name so a column added later
// does not silently shift the DDL to the wrong index.
const header = rows[0].map(h => h.trim().toLowerCase())
const iN = header.indexOf('n')
const iDdl = header.indexOf('ddl')
if (iDdl < 0) {
  console.error(`Expected a "ddl" column. Found: ${header.join(', ')}`)
  console.error('Was this the download from migrations/EXPORT_SCHEMA.sql?')
  process.exit(1)
}

const body = rows.slice(1).filter(r => r[iDdl] !== undefined && r[iDdl] !== '')
if (iN >= 0) {
  body.sort((a, b) => Number(a[iN]) - Number(b[iN]))
  // Gaps mean rows were lost — a truncated download, or a spreadsheet with a
  // filter left on. Better to refuse than to write a baseline missing a table.
  const nums = body.map(r => Number(r[iN]))
  const gaps = []
  for (let i = 1; i < nums.length; i++) if (nums[i] !== nums[i - 1] + 1) gaps.push(`${nums[i - 1]} → ${nums[i]}`)
  if (gaps.length) {
    console.error(`\nRows are missing. Gaps in the sequence: ${gaps.slice(0, 10).join(', ')}`)
    console.error('Re-download the full result set without filtering or editing it.\n')
    process.exit(1)
  }
}

const sql = body.map(r => r[iDdl]).join('\n') + '\n'
writeFileSync(output, sql)

const count = (re) => (sql.match(re) || []).length
console.log(`
  ${input} → ${output}
  ${body.length} rows, ${sql.split('\n').length} lines, ${(Buffer.byteLength(sql) / 1024).toFixed(1)} KB

  ${String(count(/CREATE TABLE/g)).padStart(4)}  tables
  ${String(count(/CREATE OR REPLACE VIEW/g)).padStart(4)}  views
  ${String(count(/CREATE OR REPLACE FUNCTION|CREATE FUNCTION/g)).padStart(4)}  functions
  ${String(count(/CREATE POLICY/g)).padStart(4)}  policies
  ${String(count(/ENABLE ROW LEVEL SECURITY/g)).padStart(4)}  tables with RLS enabled
  ${String(count(/CREATE TRIGGER/g)).padStart(4)}  triggers
  ${String(count(/CREATE (UNIQUE )?INDEX/g)).padStart(4)}  indexes

  Next: npm run inspect:baseline -- ${output}
`)
