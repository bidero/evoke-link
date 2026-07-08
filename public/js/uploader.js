// Wspólny komponent Alpine dla dropzone (strony klienta: /upload i panel /p).
// Miniatury wybranych obrazów, lista plików, postęp per-plik + łączny, stan finalizowania.
// Obsługuje też CAŁE KATALOGI: drag&drop folderu (rekurencyjnie, collectDataTransferFiles)
// oraz wybór folderu inputem z webkitdirectory — ścieżka względna wędruje na serwer
// jako nazwa pliku ('katalog/plik.pdf'), więc ZIP przy pobieraniu odtwarza strukturę.
//
// Użycie w widoku:
//   x-data="makeUploader({ chunkUrl: () => '...', finalize: async (uploadId, formEl) => {...} })"
//   finalize(): wykonuje końcowy POST i obsługuje odpowiedź; rzuca błąd przy niepowodzeniu.
(function () {
  var RASTER = /^image\/(jpeg|png|gif|webp|bmp|avif)$/;
  var JUNK = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\.localized)$|^\._/;
  var MAX_FILES = 5000; // musi odpowiadać MAX_FILES w src/services/chunk.service.js

  window.makeUploader = function (opts) {
    return {
      files: [], dragging: false, uploading: false, finalizing: false, progress: 0,

      // list: FileList (input zwykły lub webkitdirectory) albo [{ file, relPath }] z onDrop.
      addFiles: function (list) {
        var self = this;
        var over = false;
        Array.prototype.slice.call(list).forEach(function (f) {
          var file = f && f.file ? f.file : f;
          var rel = (f && f.relPath) || file.webkitRelativePath || file.name;
          var base = rel.split('/').pop();
          if (JUNK.test(base)) return;
          if (self.files.length >= MAX_FILES) { over = true; return; }
          var item = { file: file, relPath: rel, name: rel, size: file.size, progress: 0, preview: null };
          if (RASTER.test(file.type)) { try { item.preview = URL.createObjectURL(file); } catch (e) {} }
          self.files.push(item);
        });
        if (over) alert('Maksymalnie ' + MAX_FILES + ' plików w jednej wysyłce — nadmiarowe pominięto.');
      },
      onDrop: function (e) {
        var self = this;
        this.dragging = false;
        window.collectDataTransferFiles(e.dataTransfer).then(function (items) { self.addFiles(items); });
      },
      remove: function (i) {
        var it = this.files[i];
        if (it && it.preview) { try { URL.revokeObjectURL(it.preview); } catch (e) {} }
        this.files.splice(i, 1);
      },
      human: function (b) {
        if (!b) return '0 B';
        var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = Math.floor(Math.log(b) / Math.log(1024));
        return (b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
      },

      submit: function (e) {
        var self = this;
        if (!this.files.length || this.uploading) return;
        this.uploading = true; this.progress = 0;
        this.files.forEach(function (f) { f.progress = 0; });
        var raw = this.files.map(function (f) { return { file: f.file, name: f.relPath }; });
        return window.chunkedUpload(
          raw, opts.chunkUrl(),
          function (p) { self.progress = p; },
          3,
          function (fi, fp) { if (self.files[fi]) self.files[fi].progress = fp; }
        ).then(function (uploadId) {
          self.finalizing = true;
          return opts.finalize(uploadId, e && e.target);
        }).catch(function (err) {
          self.uploading = false; self.finalizing = false;
          alert(err && err.message ? err.message : 'Błąd wysyłania.');
        });
      },
    };
  };
})();
