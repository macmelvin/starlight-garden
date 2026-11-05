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

  var MAX_VIDEO_SECONDS = 60;
  var MAX_VIDEO_BYTES = 100 * 1024 * 1024;
  var MAX_VIDEOS = 3;

  function isVideoFile(file) {
    return (file.type && file.type.indexOf("video/") === 0) || /\.(mp4|mov|m4v|webm|3gp)$/i.test(file.name);
  }
  function isImageFile(file) {
    return (file.type && file.type.indexOf("image/") === 0) || /\.(heic|heif|jpe?g|png|webp|gif|avif)$/i.test(file.name);
  }

  // Read a video's length on the phone, before uploading anything.
  function videoDuration(file) {
    return new Promise(function (resolve) {
      var v = document.createElement("video");
      var url = URL.createObjectURL(file);
      var done = function (d) { URL.revokeObjectURL(url); resolve(d); };
      v.preload = "metadata";
      v.muted = true;
      v.onloadedmetadata = function () { done(isFinite(v.duration) ? v.duration : null); };
      v.onerror = function () { done(null); };
      setTimeout(function () { done(null); }, 8000);
      v.src = url;
    });
  }

  function clock(sec) {
    if (!sec) return "";
    sec = Math.round(sec);
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  // Downscale big photos in the browser so uploads are quick on phones.
  function shrinkImage(file) {
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

  // POST a form with upload progress (videos can take a while on mobile data).
  function uploadForm(url, fd, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = function () {
        var body = {};
        try { body = JSON.parse(xhr.responseText); } catch (err) {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(body.error || "Something went wrong. Please try again."));
      };
      xhr.onerror = function () { reject(new Error("The upload was interrupted. Please check your connection and try again.")); };
      xhr.send(fd);
    });
  }

  // Shared check for chosen files. Returns { ok: [{file, video, duration}], errors: [] }.
  function vetFiles(list, existing) {
    var room = 12 - existing.total;
    var videos = existing.videos;
    var picked = [], errors = [];
    var jobs = Array.prototype.map.call(list, function (file) {
      if (isVideoFile(file)) {
        if (file.size > MAX_VIDEO_BYTES) { errors.push(file.name + " is too large (100 MB max). Try a shorter clip."); return Promise.resolve(); }
        return videoDuration(file).then(function (d) {
          if (d !== null && d > MAX_VIDEO_SECONDS + 0.5) {
            errors.push(file.name + " is " + clock(d) + " long. Videos can be up to " + MAX_VIDEO_SECONDS + " seconds, so please trim it first.");
            return;
          }
          picked.push({ file: file, video: true, duration: d });
        });
      }
      if (isImageFile(file)) { picked.push({ file: file, video: false, duration: null }); return Promise.resolve(); }
      errors.push(file.name + " isn't a photo or video.");
      return Promise.resolve();
    });
    return Promise.all(jobs).then(function () {
      var ok = [];
      picked.forEach(function (p) {
        if (ok.length >= room) { errors.push("You can have up to 12 photos and videos."); return; }
        if (p.video) {
          if (videos >= MAX_VIDEOS) { errors.push("You can add up to " + MAX_VIDEOS + " videos."); return; }
          videos++;
        }
        ok.push(p);
      });
      // keep each message once
      errors = errors.filter(function (m, i) { return errors.indexOf(m) === i; });
      return { ok: ok, errors: errors };
    });
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

    var remindForm = niche.querySelector("[data-remind-form]");
    if (remindForm) {
      var rStatus = remindForm.querySelector("[data-remind-status]");
      remindForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var email = remindForm.elements.email.value.trim();
        if (!remindForm.elements.consent.checked) { setStatus(rStatus, "Please tick the box to agree to the reminder emails.", true); return; }
        if (!email) { setStatus(rStatus, "Please add your email.", true); return; }
        var btn = remindForm.querySelector("button[type=submit]");
        btn.disabled = true;
        setStatus(rStatus, "Saving…");
        postJSON("/api/pet/" + encodeURIComponent(slug) + "/remind", { email: email, consent: true })
          .then(function () {
            setStatus(rStatus, "Thank you. We'll email you before " + petName + "'s remembrance day.");
            remindForm.elements.email.value = "";
            remindForm.elements.consent.checked = false;
            track("Email reminder signup", { from: "niche" });
          })
          .catch(function (err) { setStatus(rStatus, err.message, true); })
          .finally(function () { btn.disabled = false; });
      });
    }

    var keeperUrl = store.get("sg:keeper:" + slug);
    if (keeperUrl && keeperUrl.indexOf(location.origin + "/keeper/") === 0) {
      var acts = niche.querySelector(".niche-text .actions");
      if (acts) {
        var manage = document.createElement("a");
        manage.className = "btn btn-outline";
        manage.href = keeperUrl;
        manage.textContent = "Manage this niche";
        acts.appendChild(manage);
      }
    }

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
      var dVideo = dialog.querySelector("video");
      var stage = dialog.querySelector("[data-stage]");
      var countLabel = dialog.querySelector("[data-count-label]");
      var prevBtn = dialog.querySelector("[data-prev]");
      var nextBtn = dialog.querySelector("[data-next]");
      var links = Array.prototype.slice.call(niche.querySelectorAll("[data-lightbox]"));
      var current = 0;

      function show(i) {
        if (!links.length) return;
        current = (i + links.length) % links.length;
        var a = links[current];
        var thumb = a.querySelector("img");
        dImg.style.transform = "";
        dImg.style.opacity = "1";
        dVideo.pause();
        if (a.hasAttribute("data-video")) {
          dImg.hidden = true;
          dImg.removeAttribute("src");
          dVideo.hidden = false;
          dVideo.poster = a.getAttribute("data-poster") || "";
          dVideo.src = a.getAttribute("href");
          dVideo.setAttribute("aria-label", thumb ? thumb.alt : "Video");
        } else {
          dVideo.hidden = true;
          dVideo.removeAttribute("src");
          dVideo.load();
          dImg.hidden = false;
          dImg.src = a.getAttribute("href");
          dImg.alt = thumb ? thumb.alt : "";
        }
        countLabel.textContent = (current + 1) + " / " + links.length;
        var many = links.length > 1;
        prevBtn.hidden = !many;
        nextBtn.hidden = !many;
        // warm the next photo so swiping feels instant
        var nextLink = links[(current + 1) % links.length];
        if (many && !nextLink.hasAttribute("data-video")) { var pre = new Image(); pre.src = nextLink.getAttribute("href"); }
      }
      function open(i) {
        show(i);
        dialog.showModal();
        document.body.classList.add("lightbox-open");
      }
      function close() {
        if (dialog.open) dialog.close();
      }
      dialog.addEventListener("close", function () {
        document.body.classList.remove("lightbox-open");
        dVideo.pause();
        var a = links[current];
        if (a) a.focus({ preventScroll: true });
      });

      links.forEach(function (a, i) {
        a.addEventListener("click", function (e) { e.preventDefault(); open(i); });
      });
      prevBtn.addEventListener("click", function () { show(current - 1); });
      nextBtn.addEventListener("click", function () { show(current + 1); });
      dialog.querySelector("[data-close]").addEventListener("click", close);
      dialog.addEventListener("click", function (e) { if (e.target === dialog || e.target === stage) close(); });
      dialog.addEventListener("keydown", function (e) {
        if (e.key === "ArrowLeft") show(current - 1);
        if (e.key === "ArrowRight") show(current + 1);
      });

      // Touch: swipe sideways to change photo, swipe up/down to close and go back to scrolling.
      var sx = 0, sy = 0, dx = 0, dy = 0, tracking = false;
      stage.addEventListener("touchstart", function (e) {
        if (e.touches.length !== 1) { tracking = false; return; }
        if (!dVideo.hidden) {
          var vr = dVideo.getBoundingClientRect();
          if (e.touches[0].clientY > vr.bottom - 64) { tracking = false; return; }
        }
        tracking = true;
        sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; dy = 0;
        dImg.style.transition = "none";
      }, { passive: true });
      stage.addEventListener("touchmove", function (e) {
        if (!tracking) return;
        dx = e.touches[0].clientX - sx;
        dy = e.touches[0].clientY - sy;
        var el = dImg.hidden ? dVideo : dImg;
        if (Math.abs(dx) > Math.abs(dy)) {
          el.style.transform = "translateX(" + dx + "px)";
        } else {
          el.style.transform = "translateY(" + dy + "px)";
          el.style.opacity = String(Math.max(0.3, 1 - Math.abs(dy) / 400));
        }
      }, { passive: true });
      stage.addEventListener("touchend", function () {
        if (!tracking) return;
        tracking = false;
        dImg.style.transition = "";
        dVideo.style.transform = "";
        dVideo.style.opacity = "1";
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
          show(dx < 0 ? current + 1 : current - 1);
        } else if (Math.abs(dy) > 70) {
          close();
        } else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
          dImg.style.transform = "";
        } else {
          dImg.style.transform = "";
          dImg.style.opacity = "1";
        }
      });
      // a mouse wheel / trackpad scroll also closes it, so the page keeps scrolling
      stage.addEventListener("wheel", function (e) { if (Math.abs(e.deltaY) > 30) close(); }, { passive: true });
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

    function petName(raw) {
      var first = (raw || "").trim().split(/\s+/)[0] || "";
      return first.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, function (_m, pre, ch) { return pre + ch.toUpperCase(); });
    }
    form.elements.name.addEventListener("blur", function () {
      var v = petName(form.elements.name.value);
      if (v !== form.elements.name.value) { form.elements.name.value = v; updatePreview(); }
    });

    function updatePreview() {
      previewName.textContent = petName(form.elements.name.value) || "Their name";
      var y = years();
      previewMeta.textContent = form.elements.kind.value + (y ? " · " + y : "");
      previewLine.textContent = form.elements.plaque_line.value.trim();
      var p = files[portrait];
      if (p && p.url && !p.video) {
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

    function firstImage() {
      for (var i = 0; i < files.length; i++) if (!files[i].video) return i;
      return 0;
    }

    function renderThumbs() {
      thumbs.innerHTML = "";
      files.forEach(function (f, i) {
        var isPortrait = i === portrait && !f.video;
        var wrap = document.createElement("div");
        wrap.className = "thumb" + (isPortrait ? " is-portrait" : "") + (f.video ? " is-video" : "");
        var pick = document.createElement("button");
        pick.type = "button";
        pick.className = "thumb-pick";
        if (f.video) {
          pick.setAttribute("aria-label", "Video: " + f.file.name);
          pick.disabled = true;
          var v = document.createElement("video");
          v.src = f.url + "#t=0.5";
          v.muted = true;
          v.playsInline = true;
          v.preload = "metadata";
          pick.appendChild(v);
          var pb = document.createElement("span");
          pb.className = "play-badge";
          pb.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
          if (f.duration) { var t = document.createElement("span"); t.textContent = clock(f.duration); pb.appendChild(t); }
          wrap.appendChild(pick);
          wrap.appendChild(pb);
        } else {
          pick.setAttribute("aria-label", (isPortrait ? "Portrait: " : "Use as portrait: ") + f.file.name);
          pick.setAttribute("aria-pressed", isPortrait ? "true" : "false");
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
        }
        if (isPortrait) {
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
          var wasPortrait = i === portrait;
          files.splice(i, 1);
          if (wasPortrait || portrait >= files.length || (files[portrait] && files[portrait].video)) portrait = firstImage();
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
      if (!list || !list.length) return;
      setStatus(statusEl, "Checking your files…");
      var existing = { total: files.length, videos: files.filter(function (f) { return f.video; }).length };
      vetFiles(list, existing).then(function (res) {
        res.ok.forEach(function (p) {
          files.push({ file: p.file, url: URL.createObjectURL(p.file), video: p.video, duration: p.duration });
        });
        if (!files[portrait] || files[portrait].video) portrait = firstImage();
        setStatus(statusEl, res.errors.join(" "), res.errors.length > 0);
        renderThumbs();
        updatePreview();
      });
    }

    var remindToggle = form.querySelector("[data-remind-toggle]");
    var remindEmailBox = form.querySelector("[data-remind-email]");
    if (remindToggle && remindEmailBox) {
      remindToggle.addEventListener("change", function () {
        remindEmailBox.hidden = !remindToggle.checked;
        if (remindToggle.checked) form.elements.remind_email.focus();
      });
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

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = petName(form.elements.name.value);
      if (!name) { setStatus(statusEl, "Please add their name.", true); form.elements.name.focus(); return; }
      form.elements.name.value = name;
      if (remindToggle && remindToggle.checked && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.elements.remind_email.value.trim())) {
        setStatus(statusEl, "Please check your email address for the reminders.", true);
        form.elements.remind_email.focus();
        return;
      }
      if (!files.some(function (f) { return !f.video; })) { setStatus(statusEl, "Please add at least one photo for their portrait.", true); dropzone.focus(); return; }
      var b = form.elements.born.value, p = form.elements.passed.value;
      if (b && p && b > p) { setStatus(statusEl, "The birth date should come before the date they passed.", true); return; }

      var hasVideo = files.some(function (f) { return f.video; });
      submit.disabled = true;
      setStatus(statusEl, "Preparing photos…");
      Promise.all(files.map(function (f) { return f.video ? f.file : shrinkImage(f.file); }))
        .then(function (ready) {
          var fd = new FormData();
          ["name", "kind", "born", "passed", "plaque_line", "story", "keeper_name"].forEach(function (k) {
            fd.append(k, form.elements[k].value);
          });
          fd.append("portrait", String(portrait));
          if (remindToggle && remindToggle.checked) {
            fd.append("remind_me", "on");
            fd.append("remind_email", form.elements.remind_email.value.trim());
          }
          ready.forEach(function (f) { fd.append("photos", f, f.name); });
          return uploadForm("/api/niches", fd, function (frac) {
            if (frac < 1) setStatus(statusEl, "Uploading… " + Math.round(frac * 100) + "%");
            else setStatus(statusEl, hasVideo ? "Preparing the videos so they play on every phone. This can take a minute…" : "Placing " + name + " on the Garden Wall…");
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
          var cardLink = done.querySelector("[data-done-card]");
          if (cardLink) cardLink.setAttribute("href", "/pet/" + res.slug + "#story-card");
          store.set("sg:keeper:" + res.slug, res.keeperUrl);
          track("Niche created", { kind: form.elements.kind.value, photos: files.length });
          if (remindToggle && remindToggle.checked) track("Email reminder signup", { from: "create" });
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
        var rect = card.getBoundingClientRect();
        if (rect.bottom > window.innerHeight || rect.top < 0) {
          card.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "end" });
        }
        card.classList.remove("is-flash");
        void card.offsetWidth;
        card.classList.add("is-flash");
        setTimeout(function () { card.classList.remove("is-flash"); }, 1200);
      });
    });
  }

  // ---------------- keeper ----------------
  // Two-tap confirm that works everywhere (some in-app browsers block confirm() pop-ups).
  function confirmTap(btn, armedLabel, action) {
    var original = btn.innerHTML;
    var armed = false, timer = null;
    btn.addEventListener("click", function () {
      if (btn.disabled) return;
      if (!armed) {
        armed = true;
        btn.textContent = armedLabel;
        btn.classList.add("is-armed");
        timer = setTimeout(function () { armed = false; btn.innerHTML = original; btn.classList.remove("is-armed"); }, 4000);
        return;
      }
      clearTimeout(timer);
      armed = false;
      btn.classList.remove("is-armed");
      btn.innerHTML = original;
      action();
    });
  }

  var keeper = document.querySelector("[data-keeper]");
  if (keeper) {
    var kSlug = keeper.getAttribute("data-slug");
    var token = keeper.getAttribute("data-token");
    var kStatus = keeper.querySelector("[data-keeper-status]");
    keeper.querySelectorAll("[data-remove-note]").forEach(function (btn) {
      confirmTap(btn, "Tap again to remove", function () {
        btn.disabled = true;
        postJSON("/api/keeper/" + encodeURIComponent(kSlug) + "/remove-note", { token: token, noteId: Number(btn.getAttribute("data-remove-note")) })
          .then(function () { btn.closest(".note").remove(); })
          .catch(function (err) { setStatus(kStatus, err.message, true); btn.disabled = false; });
      });
    });
    // remember the keeper link on this device so the niche page can offer "Manage this niche"
    store.set("sg:keeper:" + kSlug, location.href);

    var photoStatus = keeper.querySelector("[data-photo-status]");
    function photoAction(path, body, busyMsg) {
      setStatus(photoStatus, busyMsg);
      keeper.querySelectorAll(".kp-tile button").forEach(function (b) { b.disabled = true; });
      body.token = token;
      return postJSON("/api/keeper/" + encodeURIComponent(kSlug) + "/" + path, body)
        .then(function () { location.reload(); })
        .catch(function (err) {
          setStatus(photoStatus, err.message, true);
          keeper.querySelectorAll(".kp-tile button").forEach(function (b) { b.disabled = false; });
        });
    }
    keeper.querySelectorAll("[data-photo-portrait]").forEach(function (b) {
      b.addEventListener("click", function () { photoAction("photo-portrait", { photoId: Number(b.getAttribute("data-photo-portrait")) }, "Setting the portrait…"); });
    });
    keeper.querySelectorAll("[data-photo-move]").forEach(function (b) {
      b.addEventListener("click", function () {
        photoAction("photo-move", { photoId: Number(b.getAttribute("data-photo-id")), direction: b.getAttribute("data-photo-move") }, "Moving…");
      });
    });
    keeper.querySelectorAll("[data-photo-remove]").forEach(function (b) {
      confirmTap(b, "Tap again", function () {
        photoAction("photo-remove", { photoId: Number(b.getAttribute("data-photo-remove")) }, "Removing…");
      });
    });
    var addInput = keeper.querySelector("[data-photo-add]");
    if (addInput) {
      addInput.addEventListener("change", function () {
        var list = addInput.files;
        if (!list || !list.length) return;
        var tiles = keeper.querySelectorAll(".kp-tile");
        var existing = { total: tiles.length, videos: keeper.querySelectorAll(".kp-tile .play-badge").length };
        setStatus(photoStatus, "Checking your files…");
        vetFiles(list, existing).then(function (res) {
          addInput.value = "";
          if (!res.ok.length) { setStatus(photoStatus, res.errors.join(" ") || "Nothing to add.", true); return; }
          var hasVideo = res.ok.some(function (p) { return p.video; });
          return Promise.all(res.ok.map(function (p) { return p.video ? p.file : shrinkImage(p.file); })).then(function (ready) {
            var fd = new FormData();
            fd.append("token", token);
            ready.forEach(function (f) { fd.append("photos", f, f.name); });
            return uploadForm("/api/keeper/" + encodeURIComponent(kSlug) + "/photos", fd, function (frac) {
              if (frac < 1) setStatus(photoStatus, "Uploading… " + Math.round(frac * 100) + "%");
              else setStatus(photoStatus, hasVideo ? "Preparing the videos. This can take a minute…" : "Adding to the album…");
            });
          }).then(function () {
            location.reload();
          });
        }).catch(function (err) { setStatus(photoStatus, err.message, true); });
      });
    }

    var detailsForm = keeper.querySelector("[data-details-form]");
    if (detailsForm) {
      var dStatus = detailsForm.querySelector("[data-details-status]");
      detailsForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var body = { token: token };
        ["name", "kind", "born", "passed", "plaque_line", "story", "keeper_name", "shelter"].forEach(function (k) {
          body[k] = detailsForm.elements[k].value;
        });
        var btn = detailsForm.querySelector("button[type=submit]");
        btn.disabled = true;
        setStatus(dStatus, "Saving…");
        postJSON("/api/keeper/" + encodeURIComponent(kSlug) + "/details", body)
          .then(function () { setStatus(dStatus, "Saved."); setTimeout(function () { location.reload(); }, 700); })
          .catch(function (err) { setStatus(dStatus, err.message, true); btn.disabled = false; });
      });
    }

    var del = keeper.querySelector("[data-delete-niche]");
    if (del) {
      confirmTap(del, "Tap again to permanently remove", function () {
        del.disabled = true;
        setStatus(kStatus, "Removing the niche…");
        postJSON("/api/keeper/" + encodeURIComponent(kSlug) + "/delete", { token: token })
          .then(function () { setStatus(kStatus, "The niche has been removed."); setTimeout(function () { location.href = "/"; }, 1500); })
          .catch(function (err) { setStatus(kStatus, err.message, true); del.disabled = false; });
      });
    }
  }
})();

// ---------------- story cards ----------------
(function () {
  "use strict";
  var niche = document.querySelector("[data-niche]");
  var dialog = document.querySelector("[data-card-dialog]");
  if (!niche || !dialog || typeof dialog.showModal !== "function") return;

  var d = niche.dataset;
  var name = d.name;
  var img = dialog.querySelector("[data-card-img]");
  var statusEl = dialog.querySelector("[data-card-status]");
  var shareBtn = dialog.querySelector("[data-card-share]");
  var download = dialog.querySelector("[data-card-download]");
  var formatBtns = dialog.querySelectorAll("[data-card-format]");
  var format = "story";
  var currentFile = null;
  var currentUrl = null;
  var portrait = null; // loaded HTMLImageElement or false

  function track(n, data) { try { if (window.umami) window.umami.track(n, data); } catch (e) {} }

  function loadPortrait() {
    if (portrait !== null) return Promise.resolve(portrait);
    if (!d.portrait) { portrait = false; return Promise.resolve(false); }
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () { portrait = im; resolve(im); };
      im.onerror = function () {
        // e.g. HEIC that this browser can't show: try the thumbnail instead
        var t = new Image();
        t.onload = function () { portrait = t; resolve(t); };
        t.onerror = function () { portrait = false; resolve(false); };
        t.src = d.portrait.replace("/photo/", "/thumb/");
      };
      im.src = d.portrait;
    });
  }

  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var loading = Promise.all([
      document.fonts.load("80px Marcellus"),
      document.fonts.load("600 40px 'Source Sans 3'"),
      document.fonts.load("400 40px 'Source Sans 3'"),
    ]).catch(function () {});
    // never keep someone waiting on a slow connection: fall back to system fonts
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 2500); });
    return Promise.race([loading, timeout]);
  }

  // small seeded random so each pet's sky is the same every time
  function rng(seed) {
    var h = 2166136261;
    for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
  }

  function wrap(ctx, text, maxWidth, maxLines) {
    var words = text.split(/\s+/), lines = [], line = "";
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + " " + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = words[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (ctx.measureText(last + "…").width > maxWidth && last.length) last = last.slice(0, -1);
      lines[maxLines - 1] = last.replace(/\s+\S*$/, "") + "…";
    }
    return lines;
  }

  function fitFont(ctx, text, family, start, min, maxWidth) {
    var size = start;
    ctx.font = size + "px " + family;
    while (size > min && ctx.measureText(text).width > maxWidth) { size -= 4; ctx.font = size + "px " + family; }
    return size;
  }

  function archPath(ctx, x, y, w, h) {
    var r = w / 2;
    ctx.beginPath();
    ctx.moveTo(x, y + r);
    ctx.arc(x + r, y + r, r, Math.PI, 0);
    ctx.lineTo(x + w, y + h - 18);
    ctx.quadraticCurveTo(x + w, y + h, x + w - 18, y + h);
    ctx.lineTo(x + 18, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - 18);
    ctx.closePath();
  }

  function draw(fmt, photo) {
    var W = 1080, H = fmt === "story" ? 1920 : 1350;
    var c = document.createElement("canvas");
    c.width = W; c.height = H;
    var ctx = c.getContext("2d");
    var DISPLAY = "Marcellus, Georgia, serif";
    var BODY = "'Source Sans 3', system-ui, sans-serif";

    // sky
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#141A2B"); g.addColorStop(0.55, "#1B2236"); g.addColorStop(1, "#2C3A4A");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var rand = rng(d.niche);
    for (var i = 0; i < 140; i++) {
      var sx = rand() * W, sy = rand() * H * 0.8, sr = rand() < 0.15 ? 2.6 : rand() * 1.6 + 0.6;
      ctx.globalAlpha = 0.35 + rand() * 0.65;
      ctx.fillStyle = rand() < 0.2 ? "#F6E7C1" : "#FFFFFF";
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // moon
    var mx = W - 150, my = fmt === "story" ? 190 : 130;
    var mg = ctx.createRadialGradient(mx, my, 20, mx, my, 150);
    mg.addColorStop(0, "rgba(246,231,193,.35)"); mg.addColorStop(1, "rgba(246,231,193,0)");
    ctx.fillStyle = mg; ctx.fillRect(mx - 160, my - 160, 320, 320);
    ctx.fillStyle = "#F6E7C1"; ctx.beginPath(); ctx.arc(mx, my, 46, 0, Math.PI * 2); ctx.fill();

    // kicker
    var top = fmt === "story" ? 210 : 110;
    ctx.fillStyle = "#E8B04B";
    ctx.font = "600 34px " + BODY;
    ctx.textAlign = "center";
    if ("letterSpacing" in ctx) ctx.letterSpacing = "8px";
    ctx.fillText("IN LOVING MEMORY", W / 2, top);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

    // arched portrait in a stone alcove
    var aw = fmt === "story" ? 700 : 520, ah = fmt === "story" ? 860 : 620;
    var ax = (W - aw) / 2, ay = top + 50;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16;
    archPath(ctx, ax - 22, ay - 22, aw + 44, ah + 44);
    ctx.fillStyle = "#E4DED2"; ctx.fill();
    ctx.restore();
    archPath(ctx, ax, ay, aw, ah);
    ctx.save(); ctx.clip();
    if (photo) {
      var scale = Math.max(aw / photo.naturalWidth, ah / photo.naturalHeight);
      var pw = photo.naturalWidth * scale, ph = photo.naturalHeight * scale;
      ctx.drawImage(photo, ax + (aw - pw) / 2, ay + (ah - ph) / 2.6, pw, ph);
    } else {
      ctx.fillStyle = "#D9E2D6"; ctx.fillRect(ax, ay, aw, ah);
      ctx.fillStyle = "#4E6B52"; ctx.font = "120px " + DISPLAY; ctx.fillText(name.charAt(0).toUpperCase(), W / 2, ay + ah / 2 + 40);
    }
    ctx.restore();

    // name, dates, line
    var y = ay + ah + (fmt === "story" ? 130 : 105);
    ctx.fillStyle = "#F2EEE6";
    fitFont(ctx, name, DISPLAY, fmt === "story" ? 104 : 88, 52, W - 140);
    ctx.fillText(name, W / 2, y);
    y += fmt === "story" ? 62 : 54;
    if (d.dates) {
      ctx.fillStyle = "#C9CEDA"; ctx.font = "400 38px " + BODY;
      ctx.fillText(d.dates, W / 2, y);
      y += fmt === "story" ? 80 : 64;
    }
    if (d.line && fmt === "story") {
      ctx.fillStyle = "#E9E4DA"; ctx.font = "italic 46px " + DISPLAY;
      var lines = wrap(ctx, "“" + d.line + "”", W - 200, 2);
      lines.forEach(function (l) { ctx.fillText(l, W / 2, y); y += 60; });
    }

    // hills
    var hy = H - (fmt === "story" ? 230 : 150);
    ctx.fillStyle = "#3C5A47";
    ctx.beginPath(); ctx.moveTo(0, hy + 40);
    ctx.bezierCurveTo(W * 0.25, hy - 10, W * 0.55, hy + 50, W, hy + 10);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#4E6E57";
    ctx.beginPath(); ctx.moveTo(0, hy + 90);
    ctx.bezierCurveTo(W * 0.3, hy + 50, W * 0.7, hy + 110, W, hy + 70);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

    // call to action
    var cy = fmt === "story" ? Math.max(y + 90, hy - 120) : hy - 100;
    ctx.fillStyle = "#E8B04B"; ctx.font = "600 42px " + BODY;
    var cta = "Light a candle for " + name;
    var ctaSize = 42;
    ctx.font = "600 " + ctaSize + "px " + BODY;
    while (ctaSize > 26 && ctx.measureText("🕯 " + cta).width > W - 160) { ctaSize -= 2; ctx.font = "600 " + ctaSize + "px " + BODY; }
    ctx.fillText("🕯 " + cta, W / 2, cy);
    ctx.fillStyle = "#F2EEE6"; ctx.font = "400 30px " + BODY;
    ctx.fillText((d.host || location.host) + "/pet/" + d.niche, W / 2, cy + 52);
    return c;
  }

  function render() {
    statusEl.hidden = false;
    statusEl.textContent = "Painting the card…";
    img.removeAttribute("src");
    shareBtn.hidden = true;
    Promise.all([loadPortrait(), fontsReady()]).then(function (res) {
      var canvas = draw(format, res[0]);
      canvas.toBlob(function (blob) {
        if (!blob) { statusEl.textContent = "Sorry, this browser couldn't make the image."; return; }
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = URL.createObjectURL(blob);
        var fileName = d.niche + "-" + format + ".png";
        currentFile = new File([blob], fileName, { type: "image/png" });
        img.src = currentUrl;
        statusEl.hidden = true;
        download.href = currentUrl;
        download.setAttribute("download", fileName);
        shareBtn.hidden = !(navigator.canShare && navigator.canShare({ files: [currentFile] }));
      }, "image/png");
    });
  }

  function open() {
    dialog.showModal();
    render();
    track("Story card opened");
  }

  document.querySelectorAll("[data-open-card]").forEach(function (b) { b.addEventListener("click", open); });
  formatBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      format = b.getAttribute("data-card-format");
      formatBtns.forEach(function (x) { var on = x === b; x.classList.toggle("is-on", on); x.setAttribute("aria-pressed", on ? "true" : "false"); });
      render();
    });
  });
  shareBtn.addEventListener("click", function () {
    if (!currentFile) return;
    navigator.share({ files: [currentFile], title: "Light a candle for " + name, text: niche.getAttribute("data-share-default") })
      .then(function () { track("Story card shared", { format: format }); })
      .catch(function () {});
  });
  download.addEventListener("click", function () { track("Story card saved", { format: format }); });
  dialog.querySelector("[data-card-close]").addEventListener("click", function () { dialog.close(); });
  dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });
  if (location.hash === "#story-card") open();
})();

// owner page copy button
(function () {
  if (document.querySelector("[data-create]")) return;
  var btn = document.querySelector("[data-copy]");
  var field = document.querySelector("[data-keeper-url]");
  if (!btn || !field) return;
  btn.addEventListener("click", function () {
    field.select();
    var ok = function () { btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy link"; }, 2000); };
    if (navigator.clipboard) navigator.clipboard.writeText(field.value).then(ok, function () { document.execCommand("copy"); ok(); });
    else { document.execCommand("copy"); ok(); }
  });
})();

// ---------------- gifts ----------------
(function () {
  "use strict";
  var niche = document.querySelector("[data-niche]");
  var dialog = document.querySelector("[data-gift-dialog]");
  function track(n, data) { try { if (window.umami) window.umami.track(n, data); } catch (e) {} }

  // tidy the address after returning from payment
  if (/[?&]gift=/.test(location.search) && history.replaceState) {
    history.replaceState(null, "", location.pathname + location.hash);
    if (document.querySelector(".gift-thanks")) track("Gift paid");
  }

  if (!niche || !dialog || typeof dialog.showModal !== "function") return;
  var slug = niche.getAttribute("data-niche");
  var form = dialog.querySelector("[data-gift-form]");
  var payBtn = dialog.querySelector("[data-gift-pay]");
  var status = dialog.querySelector("[data-gift-status]");

  function selected() { return form.querySelector("input[name=gift]:checked"); }
  function updatePay() {
    var s = selected();
    payBtn.textContent = s ? "Continue to payment · " + s.getAttribute("data-price") : "Continue to payment";
  }
  form.addEventListener("change", updatePay);
  updatePay();

  document.querySelectorAll("[data-open-gifts]").forEach(function (b) {
    b.addEventListener("click", function () {
      var pick = b.getAttribute("data-gift-pick");
      if (pick) { var r = form.querySelector('input[name=gift][value="' + pick + '"]'); if (r) r.checked = true; }
      updatePay();
      status.textContent = "";
      dialog.showModal();
      track("Gift shop opened", { from: pick ? "anniversary" : "shelf" });
    });
  });
  dialog.querySelector("[data-gift-close]").addEventListener("click", function () { dialog.close(); });
  dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var s = selected();
    if (!s) { status.textContent = "Please choose a gift."; return; }
    payBtn.disabled = true;
    status.classList.remove("is-error");
    status.textContent = "Opening secure payment…";
    fetch("/api/pet/" + encodeURIComponent(slug) + "/gift", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gift: s.value, from_name: form.elements.from_name.value, message: form.elements.message.value }),
    })
      .then(function (r) { return r.json().then(function (b) { if (!r.ok) throw new Error(b.error || "Something went wrong."); return b; }); })
      .then(function (b) {
        track("Gift checkout started", { gift: s.value });
        location.href = b.url;
      })
      .catch(function (err) {
        status.textContent = err.message;
        status.classList.add("is-error");
        payBtn.disabled = false;
      });
  });
})();

// keeper: hide or show a gift
(function () {
  var keeper = document.querySelector("[data-keeper]");
  if (!keeper) return;
  var slug = keeper.getAttribute("data-slug"), token = keeper.getAttribute("data-token");
  var st = keeper.querySelector("[data-gift-hide-status]");
  keeper.querySelectorAll("[data-gift-hide]").forEach(function (b) {
    b.addEventListener("click", function () {
      b.disabled = true;
      fetch("/api/keeper/" + encodeURIComponent(slug) + "/gift-hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token, giftId: Number(b.getAttribute("data-gift-hide")), hidden: b.getAttribute("data-hidden") !== "1" }),
      })
        .then(function (r) { if (!r.ok) throw new Error("Couldn't update the gift. Please try again."); location.reload(); })
        .catch(function (err) { if (st) st.textContent = err.message; b.disabled = false; });
    });
  });
})();

// ---------------- shelter donations ----------------
(function () {
  var niche = document.querySelector("[data-niche]");
  var section = document.querySelector("#shelters");
  if (!niche || !section) return;
  var slug = niche.getAttribute("data-niche");
  var ask = section.querySelector("[data-kindness-ask]");
  var btn = section.querySelector("[data-kindness-btn]");
  var key = "sg:kind:" + slug;
  var done = false;
  try { done = !!localStorage.getItem(key); } catch (e) {}
  section.querySelectorAll("[data-shelter-link]").forEach(function (a) {
    a.addEventListener("click", function () {
      if (done) return;
      setTimeout(function () { ask.hidden = false; }, 1200);
    });
  });
  if (!btn) return;
  btn.addEventListener("click", function () {
    btn.disabled = true;
    fetch("/api/pet/" + encodeURIComponent(slug) + "/kindness", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        try { localStorage.setItem(key, "1"); } catch (e) {}
        done = true;
        var line = section.querySelector("[data-kindness-line]");
        if (typeof res.kindness === "number") {
          section.querySelector("[data-kindness-count]").textContent = res.kindness;
          section.querySelector("[data-kindness-label]").textContent = res.kindness === 1 ? "visitor has" : "visitors have";
          line.hidden = false;
        }
        ask.innerHTML = "<p>Thank you for your kindness. It means a lot.</p>";
        try { if (window.umami) window.umami.track("Shelter donation reported"); } catch (e) {}
      })
      .catch(function () { btn.disabled = false; });
  });
})();
