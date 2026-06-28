// Wspólny komponent Alpine dla dropzone (strony klienta: /upload i panel /p).
// Miniatury wybranych obrazów, lista plików, postęp per-plik + łączny, stan finalizowania.
//
// Użycie w widoku:
//   x-data="makeUploader({ chunkUrl: () => '...', finalize: async (uploadId, formEl) => {...} })"
//   finalize(): wykonuje końcowy POST i obsługuje odpowiedź; rzuca błąd przy niepowodzeniu.
(function () {
  var RASTER = /^image\/(jpeg|png|gif|webp|bmp|avif)$/;

  window.makeUploader = function (opts) {
    return {
      files: [], dragging: false, uploading: false, finalizing: false, progress: 0,

      addFiles: function (list) {
        var self = this;
        Array.prototype.slice.call(list).forEach(function (file) {
          var item = { file: file, name: file.name, size: file.size, progress: 0, preview: null };
          if (RASTER.test(file.type)) { try { item.preview = URL.createObjectURL(file); } catch (e) {} }
          self.files.push(item);
        });
      },
      onDrop: function (e) { this.dragging = false; this.addFiles(e.dataTransfer.files); },
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
        var raw = this.files.map(function (f) { return f.file; });
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
