import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getStores, upsertSingleStoreAmAcHistory } from "@/lib/db";
import ExcelJS from "exceljs";

// Aktifkan batas ukuran body lebih besar untuk upload file Excel (maks 10 MB)
export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};



const COL_PATTERNS: Record<string, RegExp[]> = {
  kd_store: [
    /^kd[\s_-]?store$/i,
    /^kode[\s_-]?store$/i,
    /^kode$/i,
    /^kd$/i,
    /^store[\s_-]?code$/i,
    /^code$/i,
  ],
  nama_store: [
    /^nama[\s_-]?store$/i,
    /^nama[\s_-]?toko$/i,
    /^nama\s+store$/i,
    /^store[\s_-]?name$/i,
    /^nama$/i,
  ],
  ac: [/area\s*coordinator/i, /\bac\b/i],
  am: [/area\s*manager/i, /\bam\b/i],
};

function matchColKey(headerText: string): string | null {
  const text = String(headerText).trim();
  if (!text) return null;
  for (const [key, patterns] of Object.entries(COL_PATTERNS)) {
    for (const pat of patterns) {
      if (pat.test(text)) return key;
    }
  }
  return null;
}

function cellStr(cell: ExcelJS.Cell): string {
  if (!cell || cell.value == null) return "";
  const v = cell.value;
  if (typeof v === "object" && "result" in v) {
    return String((v as ExcelJS.CellFormulaValue).result ?? "").trim();
  }
  if (typeof v === "object" && "richText" in v) {
    return (v as ExcelJS.CellRichTextValue).richText.map((r: any) => r.text).join("").trim();
  }
  return String(v).trim();
}

interface ParsedRow {
  kd_store: string;
  nama_store: string;
  ac: string;
  am: string;
}

interface SheetResult {
  sheetName: string;
  headerRow: number;
  colIndexes: Record<string, number>;
  rows: ParsedRow[];
}

async function parseExcel(buffer: Buffer): Promise<SheetResult[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);

  const results: SheetResult[] = [];

  wb.eachSheet((ws) => {
    const maxScanRow = 30;
    let found: SheetResult | null = null;

    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      if (found || rn > maxScanRow) return;

      const colIndexes: Record<string, number> = {};

      row.eachCell({ includeEmpty: false }, (cell, colIdx) => {
        const key = matchColKey(cellStr(cell));
        if (key && !(key in colIndexes)) {
          colIndexes[key] = colIdx;
        }
      });

      const hasKd = "kd_store" in colIndexes;
      const hasAmOrAc = "am" in colIndexes || "ac" in colIndexes;

      if (hasKd && hasAmOrAc) {
        found = {
          sheetName: ws.name,
          headerRow: rn,
          colIndexes,
          rows: [],
        };
      }
    });

    if (!found) return;

    const f = found as SheetResult;

    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      if (rn <= f.headerRow) return;

      const kdRaw = f.colIndexes.kd_store ? cellStr(row.getCell(f.colIndexes.kd_store)) : "";
      const namaRaw = f.colIndexes.nama_store ? cellStr(row.getCell(f.colIndexes.nama_store)) : "";
      const acRaw = f.colIndexes.ac ? cellStr(row.getCell(f.colIndexes.ac)) : "";
      const amRaw = f.colIndexes.am ? cellStr(row.getCell(f.colIndexes.am)) : "";

      const kdClean = kdRaw.replace(/\s+/g, "").toUpperCase();
      if (!kdClean || !/^[0-9A-Z]{4,6}$/.test(kdClean)) return;

      f.rows.push({ kd_store: kdClean, nama_store: namaRaw, ac: acRaw, am: amRaw });
    });

    if (f.rows.length > 0) {
      results.push(f);
    }
  });

  return results;
}

export async function POST(request: Request) {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: "Akses ditolak." }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const month = formData.get("month") as string | null;
    const mode = (formData.get("mode") as string) || "preview";

    if (!file) {
      return NextResponse.json({ error: "File Excel tidak ditemukan." }, { status: 400 });
    }
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { error: "Parameter month tidak valid (format: YYYY-MM)." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const sheetResults = await parseExcel(buffer);

    if (sheetResults.length === 0) {
      return NextResponse.json(
        {
          error:
            "Tidak ditemukan sheet yang memiliki kolom KD STORE dan AM/AC. " +
            "Pastikan file adalah Struktur Nasional yang valid.",
        },
        { status: 422 }
      );
    }

    // Merge semua sheet, deduplicate by kd_store (sheet pertama menang)
    const kdMap = new Map<string, ParsedRow>();
    for (const sheet of sheetResults) {
      for (const row of sheet.rows) {
        if (!kdMap.has(row.kd_store)) {
          kdMap.set(row.kd_store, row);
        }
      }
    }
    const allRows = Array.from(kdMap.values());

    // Hitung akhir bulan target (YYYY-MM-DD) untuk validasi status aktivasi Free WiFi
    const [yStr, mStr] = month.split("-");
    const yNum = parseInt(yStr, 10);
    const mNum = parseInt(mStr, 10);
    const lastDayOfMonth = new Date(yNum, mNum, 0).getDate();
    const monthEnd = `${month}-${String(lastDayOfMonth).padStart(2, "0")}`;

    // Load toko dari DB untuk cross-check kd_store dan tanggal aktivasi
    const allStores = await getStores(false);
    const kdToStore = new Map<
      string,
      { id: string; display_name: string; activation_date: string | null }
    >();
    for (const s of allStores) {
      if (s.kd_store) {
        kdToStore.set(s.kd_store.trim().toUpperCase(), {
          id: s.id,
          display_name: s.display_name,
          activation_date: s.activation_date || null,
        });
      }
    }

    const preview = allRows.map((row) => {
      const storeMatch = kdToStore.get(row.kd_store);
      const isMatched = Boolean(storeMatch);
      const actDate = storeMatch?.activation_date?.trim();
      // Toko aktif di bulan ini jika tidak ada tanggal aktivasi ATAU tanggal aktivasinya <= akhir bulan target
      const isActiveInMonth = isMatched
        ? !actDate || actDate === "-" || actDate <= monthEnd
        : false;

      return {
        kd_store: row.kd_store,
        nama_store_excel: row.nama_store,
        nama_store_db: storeMatch?.display_name ?? null,
        ac: row.ac || null,
        am: row.am || null,
        matched: isMatched,
        activeInMonth: isActiveInMonth,
        activation_date: actDate || null,
        store_id: storeMatch?.id ?? null,
      };
    });

    const matchedCount = preview.filter((r) => r.matched).length;
    const activeInMonthCount = preview.filter((r) => r.activeInMonth).length;
    const futureActiveCount = matchedCount - activeInMonthCount;
    const unmatchedCount = preview.length - matchedCount;

    const sheetsInfo = sheetResults.map((s) => ({
      name: s.sheetName,
      headerRow: s.headerRow,
      rowCount: s.rows.length,
    }));

    if (mode === "preview") {
      return NextResponse.json({
        success: true,
        mode: "preview",
        month,
        fileName: file.name,
        sheets: sheetsInfo,
        totalFound: allRows.length,
        matchedCount,
        activeInMonthCount,
        futureActiveCount,
        unmatchedCount,
        preview,
      });
    }

    if (mode === "save") {
      const saveScope = (formData.get("saveScope") as string) || "activeOnly";
      const toSave = preview.filter((r) => {
        if (!r.matched || (!r.am && !r.ac)) return false;
        if (saveScope === "activeOnly") {
          return r.activeInMonth;
        }
        return true;
      });
      let savedCount = 0;

      for (const row of toSave) {
        if (!row.kd_store) continue;
        await upsertSingleStoreAmAcHistory(row.kd_store, month, row.am || null, row.ac || null);
        savedCount++;
      }

      return NextResponse.json({
        success: true,
        mode: "save",
        month,
        savedCount,
        skippedCount: preview.length - toSave.length,
        message: `Berhasil menyimpan ${savedCount} penugasan AM/AC dari Excel untuk bulan ${month}.`,
      });
    }

    return NextResponse.json({ error: `Mode "${mode}" tidak dikenal.` }, { status: 400 });
  } catch (err: any) {
    console.error("import-excel error:", err);
    return NextResponse.json(
      { error: err.message || "Gagal memproses file Excel." },
      { status: 500 }
    );
  }
}
