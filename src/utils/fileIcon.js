// Typ pliku → ikona + kolor (lista plików na stronach klienta).
// `thumb: true` = plik nadaje się na miniaturę renderowaną z <img> (rastrowy obraz www).
const RASTER = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'];

const TYPES = [
  { exts: RASTER, icon: 'image', color: 'text-violet-600', thumb: true },
  { exts: ['svg', 'heic', 'heif', 'tif', 'tiff'], icon: 'image', color: 'text-violet-600' },
  { exts: ['pdf'], icon: 'fileText', color: 'text-red-600' },
  { exts: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'wmv', 'flv'], icon: 'video', color: 'text-pink-600' },
  { exts: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'], icon: 'music', color: 'text-amber-600' },
  { exts: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'], icon: 'archive', color: 'text-amber-700' },
  { exts: ['xls', 'xlsx', 'csv', 'ods', 'tsv'], icon: 'sheet', color: 'text-green-600' },
  { exts: ['doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'pages'], icon: 'fileText', color: 'text-sky-600' },
];

function extOf(name) {
  const parts = String(name || '').toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

// Metadane do widoku: { icon, color, thumb }. Fallback: ikona obrazu po mime, inaczej generyczna.
function fileMeta(name, mime) {
  const ext = extOf(name);
  for (const t of TYPES) if (t.exts.includes(ext)) return t;
  if (mime && /^image\//.test(mime)) return { icon: 'image', color: 'text-violet-600', thumb: /^image\/(jpeg|png|gif|webp|bmp|avif)$/.test(mime) };
  return { icon: 'file', color: 'text-slate-400' };
}

// Czy plik to rastrowy obraz www (bezpieczny do podglądu inline z <img>). SVG celowo pomijamy.
function isRaster(name, mime) {
  return RASTER.includes(extOf(name)) || /^image\/(jpeg|png|gif|webp|bmp|avif)$/.test(mime || '');
}

module.exports = { fileMeta, isRaster };
