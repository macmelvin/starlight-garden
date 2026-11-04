(function () {
  "use strict";

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  function postJSON(url, data) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || {}),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) throw new Error(body.error || "Something went wrong. Please try again.");
        return body;
      });
    });
  }

  function track(name, data) {
    try { if (window.umami && typeof window.umami.track === "function") window.umami.track(name, data); } catch (e) {}
  }

  function setCount(el, n) {
    if (!el) return;
    el.setAttribute("data-n", String(n));
    el.textContent = n + " " + (n === 1 ? el.getAttribute("data-one") : el.getAttribute("data-many"));
  }

  function setStatus(el, msg, isError) {
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("is-error", !!isError);
  }

  // ---------------- niche page ----------------
  var niche = document.querySelector("[data-niche]");
  if (niche) {
    var slug = niche.getAttribute("data-niche");
    var shareLinks = niche.querySelectorAll("[data-share]");
    var shareText = niche.querySelector("[data-share-text]");
    var shareHint = niche.querySelector("[data-share-hint]");
    var petName = niche.getAttribute("data-name");

    function setLitShare() {
      var msg = niche.getAttribute("data-share-lit");
      var href = "https://wa.me/?text=" + encodeURIComponent(msg);
      shareLinks.forEach(function (a) { a.setAttribute("href", href); });
      if (shareText) shareText.textContent = msg;
      if (shareHint) shareHint.textContent = "Your candle is glowing. Invite friends and family who loved " + petName + " to light one too.";
    }

    function markPressed(btn, kind) {
      btn.setAttribute("aria-pressed", "true");
      btn.querySelector("span").textContent = kind === "candle" ? "Candle lit" : "Flowers left";
      if (kind === "candle") setLitShare();
    }

    function addFlame() {
      var row = niche.querySelector("[data-flames]");
      if (!row) return;
      var flames = row.querySelectorAll(".flame").length;
      var textEl = row.querySelector(".flames-text");
      if (flames < 24) {
        var f = document.createElement("span");
        f.className = "flame";
        row.insertBefore(f, textEl);
      }
      if (textEl) textEl.textContent = "glowing for " + petName + " tonight";
    }

    niche.querySelectorAll("[data-tribute]").forEach(function (btn) {
      var kind = btn.getAttribute("data-tribute");
      var key = "sg:" + kind + ":" + slug;
      if (store.get(key)) markPressed(btn, kind);
      btn.addEventListener("click", function () {
        if (btn.getAttribute("aria-pressed") === "true") return;
        markPressed(btn, kind);
        store.set(key, "1");
        track(kind === "candle" ? "Light a candle" : "Leave flowers");
        if (kind === "candle") addFlame();
        postJSON("/api/pet/" + encodeURIComponent(slug) + "/" + kind)
          .then(function (res) {
            if (typeof res.candles === "number") setCount(niche.querySelector('[data-count="candles"]'), res.candles);
            if (typeof res.flowers === "number") setCount(niche.querySelector('[data-count="flowers"]'), res.flowers);
          })
          .catch(function () {});
      });
    });

    var noteForm = niche.querySelector("[data-note-form]");
    if (noteForm) {
      var status = noteForm.querySelector("[data-note-status]");
      noteForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var body = noteForm.elements.body.value.trim();
        var author = noteForm.elements.author.value.trim();
        if (!body) { setStatus(status, "Please write a few words first.", true); return; }
        var btn = noteForm.querySelector("button[type=submit]");
        btn.disabled = true;
        setStatus(status, "Leaving your note…");
        postJSON("/api/pet/" + encodeURIComponent(slug) + "/notes", { body: body, author: author })
          .then(function (res) {
            var list = niche.querySelector("[data-notes]");
            var empty = list.querySelector(".note-empty");
            if (empty) empty.remove();
            list.insertAdjacentHTML("afterbegin", res.html);
            noteForm.elements.body.value = "";
            var n = niche.querySelector('[data-count="notes"]');
            if (n) setCount(n, parseInt(n.textContent, 10) + 1);
            setStatus(status, "Thank you. Your note has been left for " + petName + ".");
            track("Leave a note");
          })
          .catch(function (err) { setStatus(status, err.message, true); })
          .finally(function () { btn.disabled = false; });
      });
    }

    var dialog = document.querySelector("[data-lightbox-dialog]");
    if (dialog && typeof dialog.showModal === "function") {
      var dImg = dialog.querySelector("img");
      niche.querySelectorAll("[data-lightbox]").forEach(function (a) {
        a.addEventListener("click", function (e) {
          e.preventDefault();
          var img = a.querySelector("img");
          dImg.src = a.getAttribute("href");
          dImg.alt = img ? img.alt : "";
          dialog.showModal();
        });
      });
      dialog.querySelector("[data-close]").addEventListener("click", function () { dialog.close(); });
      dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });
    }
  }

  // ---------------- create page ----------------
  var create = document.querySelector("[data-create]");
  if (create) {
    var form = create.querySelector("[data-create-form]");
    var input = form.querySelector("#photos");
    var dropzone = form.querySelector("[data-dropzone]");
    var thumbs = form.querySelector("[data-thumbs]");
    var thumbsHint = form.querySelector("[data-thumbs-hint]");
    var statusEl = form.querySelector("[data-create-status]");
    var submit = form.querySelector("[data-create-submit]");
    var previewPhoto = create.querySelector("[data-preview-photo]");
    var previewName = create.querySelector("[data-preview-name]");
    var previewMeta = create.querySelector("[data-preview-meta]");
    var previewLine = create.querySelector("[data-preview-line]");
    var placeholderHTML = previewPhoto.innerHTML;
    var MAX = 12;
    var files = []; // { file, url }
    var portrait = 0;

    function years() {
      var b = form.elements.born.value.slice(0, 4);
      var p = form.elements.passed.value.slice(0, 4);
      if (b && p) return b + " – " + p;
      if (p) return "Passed " + p;
      if (b) return "Born " + b;
      return "";
    }

    function updatePreview() {
      previewName.textContent = form.elements.name.value.trim() || "Their name";
      var y = years();
      previewMeta.textContent = form.elements.kind.value + (y ? " · " + y : "");
      previewLine.textContent = form.elements.plaque_line.value.trim();
      var p = files[portrait];
      if (p && p.url) {
        previewPhoto.classList.remove("placeholder");
        previewPhoto.innerHTML = "";
        var img = document.createElement("img");
        img.src = p.url;
        img.alt = "";
        img.className = "alcove-photo";
        img.onerror = function () { previewPhoto.classList.add("placeholder"); previewPhoto.innerHTML = placeholderHTML; };
        previewPhoto.appendChild(img);
      } else {
        previewPhoto.classList.add("placeholder");
        previewPhoto.innerHTML = placeholderHTML;
      }
    }

    function renderThumbs() {
      thumbs.innerHTML = "";
      files.forEach(function (f, i) {
        var wrap = document.createElement("div");
        wrap.className = "thumb" + (i === portrait ? " is-portrait" : "");
        var pick = document.createElement("button");
        pick.type = "button";
        pick.className = "thumb-pick";
        pick.setAttribute("aria-label", (i === portrait ? "Portrait: " : "Use as portrait: ") + f.file.name);
        pick.setAttribute("aria-pressed", i === portrait ? "true" : "false");
        var img = document.createElement("img");
        img.src = f.url;
        img.alt = "";
        img.onerror = function () {
          img.remove();
          var fb = document.createElement("span");
          fb.className = "thumb-fallback";
          fb.textContent = f.file.name;
          pick.appendChild(fb);
        };
        pick.appendChild(img);
        pick.addEventListener("click", function () { portrait = i; renderThumbs(); updatePreview(); });
        wrap.appendChild(pick);
        if (i === portrait) {
          var badge = document.createElement("span");
          badge.className = "thumb-badge";
          badge.textContent = "Portrait";
          wrap.appendChild(badge);
        }
        var rm = document.createElement("button");
        rm.type = "button";
        rm.className = "thumb-remove";
        rm.setAttribute("aria-label", "Remove " + f.file.name);
        rm.textContent = "×";
        rm.addEventListener("click", function () {
          URL.revokeObjectURL(f.url);
          files.splice(i, 1);
          if (portrait >= files.length) portrait = Math.max(0, files.length - 1);
          else if (i < portrait) portrait--;
          renderThumbs();
          updatePreview();
        });
        wrap.appendChild(rm);
        thumbs.appendChild(wrap);
      });
      thumbsHint.hidden = files.length === 0;
    }

    function addFiles(list) {
      var added = 0;
      Array.prototype.forEach.call(list, function (file) {
        if (files.length >= MAX) return;
        if (file.type && file.type.indexOf("image/") !== 0 && !/\.(heic|heif)$/i.test(file.name)) return;
        files.push({ file: file, url: URL.createObjectURL(file) });
        added++;
      });
      if (files.length >= MAX && added < list.length) setStatus(statusEl, "You can add up to " + MAX + " photos.", true);
      else setStatus(statusEl, "");
      renderThumbs();
      updatePreview();
    }

    input.addEventListener("change", function () { addFiles(input.files); input.value = ""; });
    ["dragenter", "dragover"].forEach(function (t) {
      dropzone.addEventListener(t, function (e) { e.preventDefault(); dropzone.classList.add("is-over"); });
    });
    ["dragleave", "drop"].forEach(function (t) {
      dropzone.addEventListener(t, function (e) { e.preventDefault(); dropzone.classList.remove("is-over"); });
    });
    dropzone.addEventListener("drop", function (e) { if (e.dataTransfer) addFiles(e.dataTransfer.files); });
    ["input", "change"].forEach(function (t) { form.addEventListener(t, function (e) { if (e.target !== input) updatePreview(); }); });

    // Downscale big photos in the browser so uploads are quick on phones.
    function shrink(file) {
      if (!window.createImageBitmap || file.size < 400 * 1024 || file.type === "image/gif") return Promise.resolve(file);
      return createImageBitmap(file, { imageOrientation: "from-image" })
        .then(function (bmp) {
          var max = 2000;
          var scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
          var c = document.createElement("canvas");
          c.width = Math.round(bmp.width * scale);
          c.height = Math.round(bmp.height * scale);
          c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
          return new Promise(function (resolve) {
            c.toBlob(function (blob) {
              if (!blob || blob.size >= file.size) return resolve(file);
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
            }, "image/jpeg", 0.86);
          });
        })
        .catch(function () { return file; });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = form.elements.name.value.trim();
      if (!name) { setStatus(statusEl, "Please add their name.", true); form.elements.name.focus(); return; }
      if (!files.length) { setStatus(statusEl, "Please add at least one photo.", true); dropzone.focus(); return; }
      var b = form.elements.born.value, p = form.elements.passed.value;
      if (b && p && b > p) { setStatus(statusEl, "The birth date should come before the date they passed.", true); return; }

      submit.disabled = true;
      setStatus(statusEl, "Preparing photos…");
      Promise.all(files.map(function (f) { return shrink(f.file); }))
        .then(function (ready) {
          var fd = new FormData();
          ["name", "kind", "born", "passed", "plaque_line", "story", "keeper_name"].forEach(function (k) {
            fd.append(k, form.elements[k].value);
          });
          fd.append("portrait", String(portrait));
          ready.forEach(function (f) { fd.append("photos", f, f.name); });
          setStatus(statusEl, "Placing " + name + " on the Garden Wall…");
          return fetch("/api/niches", { method: "POST", body: fd }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (body) {
              if (!r.ok) throw new Error(body.error || "Something went wrong. Please try again.");
              return body;
            });
          });
        })
        .then(function (res) {
          var done = document.querySelector("[data-done]");
          create.hidden = true;
          document.querySelector(".page-title").hidden = true;
          document.querySelector(".lede-dark").hidden = true;
          done.hidden = false;
          done.querySelector("[data-done-title]").textContent = name + "'s niche is ready";
          done.querySelector("[data-keeper-url]").value = res.keeperUrl;
          done.querySelector("[data-done-visit]").setAttribute("href", "/pet/" + res.slug);
          done.querySelector("[data-done-visit]").textContent = "Visit " + name + "'s niche";
          done.querySelector("[data-done-share]").setAttribute("href", res.shareUrl);
          store.set("sg:keeper:" + res.slug, res.keeperUrl);
          track("Niche created", { kind: form.elements.kind.value, photos: files.length });
          done.scrollIntoView({ behavior: "smooth", block: "start" });
          done.querySelector("h2").setAttribute("tabindex", "-1");
          done.querySelector("h2").focus({ preventScroll: true });
        })
        .catch(function (err) {
          setStatus(statusEl, err.message, true);
          track("Niche create failed", { reason: String(err.message).slice(0, 80) });
          submit.disabled = false;
        });
    });

    var copyBtn = document.querySelector("[data-copy]");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var field = document.querySelector("[data-keeper-url]");
        field.select();
        var ok = function () { copyBtn.textContent = "Copied"; setTimeout(function () { copyBtn.textContent = "Copy link"; }, 2000); };
        if (navigator.clipboard) navigator.clipboard.writeText(field.value).then(ok, function () { document.execCommand("copy"); ok(); });
        else { document.execCommand("copy"); ok(); }
      });
    }
    updatePreview();
  }

  // ---------------- night sky ----------------
  var card = document.querySelector("[data-sky-card]");
  if (card) {
    var stars = document.querySelectorAll("[data-star]");
    stars.forEach(function (star) {
      star.addEventListener("click", function () {
        stars.forEach(function (s) { s.classList.remove("is-on"); s.setAttribute("aria-pressed", "false"); });
        star.classList.add("is-on");
        star.setAttribute("aria-pressed", "true");
        var d = star.dataset;
        card.querySelector("[data-sky-name]").textContent = d.name;
        card.querySelector("[data-sky-meta]").textContent = [d.kind, d.years, d.candles + (d.candles === "1" ? " candle lit" : " candles lit")].filter(Boolean).join(" · ");
        var link = card.querySelector("[data-sky-link]");
        link.setAttribute("href", "/pet/" + d.slug);
        link.textContent = "Visit " + d.name + "'s niche";
        var ph = card.querySelector("[data-sky-photo]");
        if (d.photo) {
          ph.innerHTML = "";
          var img = document.createElement("img");
          img.src = d.photo;
          img.alt = "";
          ph.appendChild(img);
        }
        if (history.replaceState) history.replaceState(null, "", "/sky?pet=" + encodeURIComponent(d.slug));
      });
    });
  }

  // ---------------- keeper ----------------
  var keeper = document.querySelector("[data-keeper]");
  if (keeper) {
    var kSlug = keeper.getAttribute("data-slug");
    var token = keeper.getAttribute("data-token");
    var kStatus = keeper.querySelector("[data-keeper-status]");
    keeper.querySelectorAll("[data-remove-note]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("Remove this note from the niche?")) return;
        btn.disabled = true;
        postJSON("/api/keeper/" + encodeURIComponent(kSlug) + "/remove-note", { token: token, noteId: Number(btn.getAttribute("data-remove-note")) })
          .then(function () { btn.closest(".note").remove(); })
          .catch(function (err) { alert(err.message); btn.disabled = false; });
      });
    });
    var del = keeper.querySelector("[data-delete-niche]");
    if (del) {
      del.addEventListener("click", function () {
        if (!confirm("Permanently remove this niche, its photos and every tribute? This can't be undone.")) return;
        del.disabled = true;
        setStatus(kStatus, "Removing the niche…");
        postJSON("/api/keeper/" + encodeURIComponent(kSlug) + "/delete", { token: token })
          .then(function () { setStatus(kStatus, "The niche has been removed."); setTimeout(function () { location.href = "/"; }, 1500); })
          .catch(function (err) { setStatus(kStatus, err.message, true); del.disabled = false; });
      });
    }
  }
})();
