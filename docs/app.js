(() => {
  const REPO = "https://github.com/LPJXLOVE/gpt-image-gif-playbook/blob/main/";
  const CATEGORIES = [
    ["all", "All", ""],
    ["游戏与像素", "Games and pixel", "games-and-pixel"],
    ["表情与角色", "Characters and stickers", "characters-and-stickers"],
    ["品牌与实物", "Brand and objects", "brand-and-objects"],
    ["人物与场景", "People and scenes", "people-and-scenes"],
    ["视频流程", "Video workflows", "video-workflows"],
  ];

  const PROMPTS = [
    ["all", "Any prompt"],
    ["完整", "Full"],
    ["节选", "Excerpt"],
    ["未采集", "Not collected"],
  ];

  const HASH = {
    "games-and-pixel": ["游戏与像素", "all"],
    "characters-and-stickers": ["表情与角色", "all"],
    "brand-and-objects": ["品牌与实物", "all"],
    "people-and-scenes": ["人物与场景", "all"],
    "video-workflows": ["视频流程", "all"],
    "full-prompts": ["all", "完整"],
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const grid = document.getElementById("grid");
  const pinStage = document.getElementById("pin-stage");
  const search = document.getElementById("search");
  const count = document.getElementById("count");
  const empty = document.getElementById("empty");
  const state = { category: "all", prompt: "all", query: "", pinned: "" };
  let entries = [];

  const embedQueue = [];
  let embedActive = 0;

  function enqueue(task) {
    return new Promise((resolve) => {
      embedQueue.push(() => Promise.resolve()
        .then(task)
        .then(resolve, () => resolve(false)));
      pump();
    });
  }

  function pump() {
    while (embedActive < 2 && embedQueue.length) {
      const job = embedQueue.shift();
      embedActive += 1;
      Promise.resolve()
        .then(job)
        .finally(() => {
          embedActive -= 1;
          pump();
        });
    }
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
  }

  function whenTwitter() {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (window.twttr && window.twttr.widgets && window.twttr.ready) {
          window.twttr.ready(resolve);
          return;
        }
        if (Date.now() - started > 10000) reject(new Error("widgets"));
        else setTimeout(tick, 50);
      };
      tick();
    });
  }

  function mountTweet(host, postId, quiet) {
    host.replaceChildren();
    let pending = null;
    if (!quiet) {
      pending = document.createElement("p");
      pending.className = "wait";
      pending.textContent = "Loading the original post…";
      host.append(pending);
    }
    return enqueue(async () => {
      const twttr = await withTimeout(whenTwitter(), 10000);
      const el = await withTimeout(twttr.widgets.createTweet(String(postId), host, {
        cards: "visible",
        conversation: "none",
        align: "center",
        lang: "zh",
        dnt: true,
      }), 12000);
      if (pending) pending.remove();
      return Boolean(el);
    });
  }

  function primary(entry) {
    return entry.media.find((item) => item.play_mp4) || entry.media[0];
  }

  function externalLink(href, text) {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = text;
    return a;
  }

  function applyFilters() {
    const q = state.query.trim().toLowerCase();
    let shown = 0;
    grid.querySelectorAll(".card").forEach((card) => {
      const entry = entries[Number(card.dataset.index)];
      const hay = [
        entry.title_zh,
        entry.publisher_handle,
        entry.publisher_name,
        entry.category,
        entry.editorial_summary_zh,
        entry.prompt_text,
        entry.excerpt,
        entry.prompt_level,
        entry.media_type,
      ].join("\n").toLowerCase();
      const ok = (state.category === "all" || entry.category === state.category)
        && (state.prompt === "all" || entry.prompt_level === state.prompt)
        && (!q || hay.includes(q));
      card.hidden = !ok;
      if (ok) shown += 1;
    });
    count.textContent = shown + (shown === 1 ? " post" : " posts");
    empty.hidden = shown !== 0;
    const visible = [...grid.querySelectorAll(".card:not([hidden])")];
    grid.querySelectorAll(".card").forEach((card) => { card.tabIndex = -1; });
    if (visible[0]) visible[0].tabIndex = 0;
  }

  function setPressed(container, attr, value) {
    container.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset[attr] === value ? "true" : "false");
    });
  }

  function selectFrame(card, index) {
    const entry = entries[Number(card.dataset.index)];
    const item = entry.media[index];
    const img = card.querySelector(".thumb");
    const video = card.querySelector("video");
    img.dataset.broken = "0";
    img.classList.remove("is-broken");
    img.hidden = false;
    img.src = item.preview_image_url;
    img.width = item.width || 512;
    img.height = item.height || 512;
    card.querySelector(".shot").style.aspectRatio = `${item.width || 1} / ${item.height || 1}`;
    card.querySelectorAll(".strip button").forEach((button, buttonIndex) => {
      button.setAttribute("aria-current", buttonIndex === index ? "true" : "false");
    });
    if (!video) return;
    if (item.play_mp4) {
      video.classList.remove("is-broken");
      video.poster = item.preview_image_url;
      if (video.dataset.src !== item.play_mp4) {
        video.dataset.src = item.play_mp4;
        video.src = item.play_mp4;
        video.load();
      }
      if (card.dataset.userPaused !== "1") {
        video.play().catch(() => {});
      }
    } else {
      video.pause();
      video.removeAttribute("src");
      video.classList.remove("is-live");
      video.classList.add("is-broken");
      card.dataset.mediaState = "thumb";
    }
  }

  function syncPlay(card) {
    const button = card.querySelector(".play");
    const video = card.querySelector("video");
    if (!button || !video) return;
    if (video.classList.contains("is-broken") || card.dataset.mediaState === "embed" || card.dataset.mediaState === "link") {
      button.hidden = true;
      return;
    }
    button.hidden = false;
    const playing = video.classList.contains("is-live") && !video.paused;
    button.textContent = playing ? "Pause" : "Play";
    button.setAttribute("aria-label", playing ? "Pause animation" : "Play animation");
  }

  function togglePlay(card) {
    if (card.dataset.hot !== "1") {
      card.dataset.userPaused = "0";
      activate(card);
      return;
    }
    const video = card.querySelector("video");
    if (!video || !video.getAttribute("src") || video.classList.contains("is-broken") || card.dataset.mediaState === "link" || card.dataset.mediaState === "embed") return;
    if (video.paused) {
      card.dataset.userPaused = "0";
      video.play().catch(() => {});
    } else {
      card.dataset.userPaused = "1";
      video.pause();
    }
    syncPlay(card);
  }

  function toggleDetail(card) {
    const panel = card.querySelector(".detail");
    const button = card.querySelector(".prompt");
    const open = panel.hidden;
    panel.hidden = !open;
    card.classList.toggle("is-open", open);
    button.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function showMiss(card) {
    card.dataset.mediaState = "link";
    const shot = card.querySelector(".shot");
    const embed = card.querySelector(".embed");
    const miss = card.querySelector(".miss");
    if (shot) shot.hidden = true;
    if (embed) embed.hidden = true;
    if (miss) miss.hidden = false;
    const play = card.querySelector(".play");
    if (play) play.hidden = true;
  }

  async function fallbackEmbed(card) {
    if (card.dataset.mediaState === "embed" || card.dataset.mediaState === "link") return;
    card.dataset.mediaState = "embed";
    const shot = card.querySelector(".shot");
    const embed = card.querySelector(".embed");
    if (shot) shot.hidden = true;
    embed.hidden = false;
    const play = card.querySelector(".play");
    if (play) play.hidden = true;
    const ok = await mountTweet(embed, card.dataset.postId, false);
    if (!ok) showMiss(card);
  }

  function bindPicture(card) {
    const img = card.querySelector(".thumb");
    const video = card.querySelector("video");
    img.addEventListener("error", () => {
      img.dataset.broken = "1";
      img.classList.add("is-broken");
      const live = video && video.classList.contains("is-live");
      const pending = video && video.getAttribute("src") && !live && !video.classList.contains("is-broken");
      if (!live && !pending) fallbackEmbed(card);
    });
    img.addEventListener("load", () => {
      if (img.naturalWidth > 0) {
        if (card.dataset.mediaState === "loading") card.dataset.mediaState = video ? "thumb" : "poster";
        return;
      }
      img.dataset.broken = "1";
      img.classList.add("is-broken");
      if (!(video && video.classList.contains("is-live"))) fallbackEmbed(card);
    });
    if (!video) return;
    const failVideo = () => {
      if (video.classList.contains("is-broken")) return;
      video.classList.remove("is-live");
      video.classList.add("is-broken");
      video.pause();
      if (img.dataset.broken === "1") fallbackEmbed(card);
      else card.dataset.mediaState = "thumb";
      syncPlay(card);
    };
    video.addEventListener("error", failVideo);
    video.addEventListener("loadeddata", () => {
      if (video.videoWidth === 0) {
        failVideo();
        return;
      }
      video.classList.add("is-live");
      video.classList.remove("is-broken");
      card.dataset.mediaState = video.paused ? "thumb" : "playing";
      syncPlay(card);
    });
    video.addEventListener("play", () => {
      card.dataset.mediaState = "playing";
      syncPlay(card);
    });
    video.addEventListener("pause", () => {
      if (card.dataset.mediaState === "playing") card.dataset.mediaState = "thumb";
      syncPlay(card);
    });
    if (reduceMotion) {
      video.addEventListener("play", function stopOnce() {
        if (card.dataset.userPaused === "1") return;
        video.pause();
        card.dataset.userPaused = "1";
        video.removeEventListener("play", stopOnce);
      });
    }
  }

  function activate(node) {
    if (node.id === "pin-stage") {
      if (node.dataset.hot === "1") return;
      node.dataset.hot = "1";
      const img = node.querySelector(".thumb");
      const entry = entries.find((item) => item.post_id === state.pinned);
      const item = primary(entry);
      img.src = item.preview_image_url;
      img.addEventListener("error", () => {
        img.dataset.broken = "1";
        img.classList.add("is-broken");
        if (node.dataset.embedFailed === "1") {
          node.querySelector(".miss").hidden = false;
          node.dataset.mediaState = "link";
        }
      }, { once: true });
      const token = node.dataset.token;
      mountTweet(node.querySelector(".embed"), entry.post_id, true).then((ok) => {
        if (node.dataset.token !== token) return;
        if (ok) {
          node.querySelector(".shot").hidden = true;
          node.dataset.mediaState = "embed";
        } else if (img.dataset.broken === "1" || (img.complete && img.naturalWidth === 0)) {
          node.querySelector(".miss").hidden = false;
          node.dataset.mediaState = "link";
        } else {
          node.dataset.embedFailed = "1";
          node.dataset.mediaState = "thumb";
        }
      });
      return;
    }
    const card = node;
    if (card.dataset.hot !== "1") {
      card.dataset.hot = "1";
      card.querySelectorAll(".strip img").forEach((image) => {
        if (!image.getAttribute("src")) image.src = image.dataset.src;
      });
      selectFrame(card, Number(card.dataset.frame || "0"));
      return;
    }
    const video = card.querySelector("video");
    if (video && card.dataset.userPaused !== "1" && video.src && card.dataset.mediaState !== "link") {
      video.play().catch(() => {});
    }
  }

  const observer = new IntersectionObserver((records) => {
    records.forEach((record) => {
      if (!record.isIntersecting) {
        const video = record.target.querySelector("video");
        if (video && !video.paused) video.pause();
        return;
      }
      activate(record.target);
    });
  }, { rootMargin: "240px 0px" });

  function renderPin(entry, scroll) {
    state.pinned = entry.post_id;
    pinStage.replaceChildren();
    pinStage.dataset.hot = "0";
    pinStage.dataset.mediaState = "loading";
    pinStage.dataset.token = String(Number(pinStage.dataset.token || "0") + 1);
    const item = primary(entry);
    const shot = document.createElement("div");
    shot.className = "shot";
    shot.style.aspectRatio = `${item.width || 1} / ${item.height || 1}`;
    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = `Pinned preview: ${entry.title_zh} by ${entry.publisher_handle}`;
    img.decoding = "async";
    const cite = document.createElement("p");
    cite.className = "cite";
    cite.textContent = `${entry.publisher_handle} · ${entry.title_zh}`;
    shot.append(img, cite);
    const embed = document.createElement("div");
    embed.className = "embed";
    const miss = document.createElement("p");
    miss.className = "miss";
    miss.hidden = true;
    miss.append(externalLink(entry.canonical_post_url, "Open the original post"));
    pinStage.append(shot, embed, miss);
    document.querySelectorAll(".card .pin").forEach((button) => {
      button.setAttribute("aria-pressed", button.closest(".card").dataset.postId === entry.post_id ? "true" : "false");
    });
    observer.observe(pinStage);
    activate(pinStage);
    if (scroll) pinStage.scrollIntoView({ block: "start" });
  }

  function fillDetail(entry, panel) {
    const level = document.createElement("p");
    level.className = "level";
    if (entry.prompt_level === "完整") {
      level.textContent = "Full prompt";
      const pre = document.createElement("pre");
      pre.textContent = entry.prompt_text;
      panel.append(level, pre);
      if (entry.prompt_file) panel.append(externalLink(REPO + entry.prompt_file, "Prompt file"));
    } else if (entry.prompt_level === "节选") {
      level.textContent = "Excerpt";
      const quote = document.createElement("blockquote");
      quote.textContent = entry.excerpt;
      const note = document.createElement("p");
      note.textContent = "Only this public fragment was collected. It is not a full prompt.";
      panel.append(level, quote, note);
    } else {
      level.textContent = "Not collected";
      const note = document.createElement("p");
      note.textContent = "No prompt was collected from this post. Nothing here was inferred from the picture.";
      panel.append(level, note);
      if (entry.prompt_status) {
        const status = document.createElement("p");
        status.textContent = entry.prompt_status;
        panel.append(status);
      }
    }
    if (entry.editorial_summary_zh) {
      const label = document.createElement("p");
      label.className = "level";
      label.textContent = "Editorial note";
      const summary = document.createElement("p");
      summary.textContent = entry.editorial_summary_zh;
      panel.append(label, summary);
    }
    const posted = document.createElement("p");
    posted.textContent = entry.posted_at_pt;
    const role = document.createElement("p");
    role.textContent = entry.publisher_role;
    const rights = document.createElement("p");
    rights.textContent = entry.rights;
    const limits = document.createElement("p");
    limits.textContent = entry.limits_zh;
    panel.append(posted, role, rights, limits, externalLink(entry.canonical_post_url, "Original post"));
    if (entry.notes_file) {
      panel.append(" ");
      panel.append(externalLink(REPO + entry.notes_file, "Notes"));
    }
  }

  function renderCard(entry, index) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.postId = entry.post_id;
    card.dataset.index = String(index);
    card.dataset.category = entry.category;
    card.dataset.mediaState = "loading";
    card.dataset.frame = String(Math.max(0, entry.media.findIndex((item) => item.play_mp4)));
    card.tabIndex = index === 0 ? 0 : -1;

    const shot = entry.media_type === "video" ? document.createElement("a") : document.createElement("div");
    shot.className = "shot";
    if (entry.media_type === "video") {
      shot.href = entry.canonical_post_url;
      shot.target = "_blank";
      shot.rel = "noopener noreferrer";
      shot.setAttribute("aria-label", `Open the original video post: ${entry.title_zh}`);
    }
    const item = entry.media[Number(card.dataset.frame)] || entry.media[0];
    shot.style.aspectRatio = `${item.width || 1} / ${item.height || 1}`;
    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = `${entry.media_type === "video" ? "Video poster" : "GIF preview"}: ${entry.title_zh} by ${entry.publisher_handle}`;
    img.decoding = "async";
    img.loading = "lazy";
    const cite = document.createElement("p");
    cite.className = "cite";
    cite.textContent = `${entry.publisher_handle} · ${entry.title_zh}`;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = entry.media_type === "video" ? "Video" : "GIF";
    shot.append(img, cite, badge);
    if (entry.media_type === "animated_gif") {
      const video = document.createElement("video");
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute("autoplay", "");
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
      video.setAttribute("loop", "");
      video.setAttribute("aria-label", entry.title_zh);
      shot.append(video);
      shot.addEventListener("click", () => togglePlay(card));
    }

    const embed = document.createElement("div");
    embed.className = "embed";
    embed.hidden = true;
    const miss = document.createElement("p");
    miss.className = "miss";
    miss.hidden = true;
    miss.append(externalLink(entry.canonical_post_url, "Open the original post"));

    const bar = document.createElement("div");
    bar.className = "bar";
    const title = document.createElement("h2");
    title.textContent = entry.title_zh;
    bar.append(title, externalLink(entry.canonical_post_url, entry.publisher_handle));
    if (entry.media_type === "animated_gif") {
      const play = document.createElement("button");
      play.type = "button";
      play.className = "play";
      play.textContent = "Play";
      play.addEventListener("click", () => togglePlay(card));
      bar.append(play);
    }
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "pin";
    pin.textContent = "Pin";
    pin.setAttribute("aria-pressed", "false");
    pin.setAttribute("aria-label", "Pin the official post card");
    pin.addEventListener("click", () => renderPin(entry, true));
    const prompt = document.createElement("button");
    prompt.type = "button";
    prompt.className = "prompt";
    prompt.textContent = "Prompt";
    prompt.setAttribute("aria-expanded", "false");
    prompt.addEventListener("click", () => toggleDetail(card));
    bar.append(pin, prompt, externalLink(entry.canonical_post_url, "Original post"));

    const detail = document.createElement("div");
    detail.className = "detail";
    detail.hidden = true;
    fillDetail(entry, detail);

    card.append(shot, embed, miss);
    if (entry.media.length > 1) {
      const strip = document.createElement("div");
      strip.className = "strip";
      entry.media.forEach((media, mediaIndex) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-label", `Show attachment ${mediaIndex + 1}`);
        const thumb = document.createElement("img");
        thumb.alt = "";
        thumb.dataset.src = media.preview_image_url;
        button.append(thumb);
        button.addEventListener("click", () => selectFrame(card, mediaIndex));
        strip.append(button);
      });
      card.append(strip);
    }
    card.append(bar, detail);
    card.addEventListener("keydown", (event) => {
      if (event.target !== card) return;
      if (event.key === "Enter") {
        event.preventDefault();
        toggleDetail(card);
      } else if (event.key === " ") {
        event.preventDefault();
        if (entry.media_type === "animated_gif") togglePlay(card);
        else window.open(entry.canonical_post_url, "_blank", "noopener,noreferrer");
      }
    });
    bindPicture(card);
    return card;
  }

  function columnCount() {
    const columns = getComputedStyle(grid).gridTemplateColumns;
    return Math.max(1, columns.split(" ").length);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== search) {
      event.preventDefault();
      search.focus();
      return;
    }
    if (event.key === "Escape") {
      const open = grid.querySelector(".card.is-open");
      if (open) {
        open.querySelector(".detail").hidden = true;
        open.classList.remove("is-open");
        open.querySelector(".prompt").setAttribute("aria-expanded", "false");
        open.focus();
      }
      return;
    }
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    if (document.activeElement === search) return;
    const cards = [...grid.querySelectorAll(".card:not([hidden])")];
    if (!cards.length) return;
    const current = document.activeElement && document.activeElement.closest
      ? document.activeElement.closest(".card")
      : null;
    let index = Math.max(0, cards.indexOf(current));
    if (current) {
      const step = event.key === "ArrowRight" ? 1
        : event.key === "ArrowLeft" ? -1
          : event.key === "ArrowDown" ? columnCount()
            : -columnCount();
      index = Math.max(0, Math.min(cards.length - 1, index + step));
    }
    event.preventDefault();
    cards.forEach((card) => { card.tabIndex = -1; });
    cards[index].tabIndex = 0;
    cards[index].focus();
  });

  function setupFilters() {
    const categories = document.getElementById("category-filters");
    const prompts = document.getElementById("prompt-filters");
    CATEGORIES.forEach(([id, label, hash]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.category = id;
      button.dataset.hash = hash;
      button.textContent = label;
      button.setAttribute("aria-pressed", id === "all" ? "true" : "false");
      button.addEventListener("click", () => {
        state.category = id;
        setPressed(categories, "category", id);
        history.replaceState(null, "", hash ? `#${hash}` : `${location.pathname}${location.search}`);
        applyFilters();
      });
      categories.append(button);
    });
    PROMPTS.forEach(([id, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.prompt = id;
      button.textContent = label;
      button.setAttribute("aria-pressed", id === "all" ? "true" : "false");
      button.addEventListener("click", () => {
        state.prompt = id;
        setPressed(prompts, "prompt", id);
        applyFilters();
      });
      prompts.append(button);
    });
    search.addEventListener("input", () => {
      state.query = search.value;
      applyFilters();
    });
    window.addEventListener("hashchange", readHash);
  }

  function readHash() {
    const spec = HASH[location.hash.slice(1)];
    if (!spec) return;
    state.category = spec[0];
    state.prompt = spec[1];
    setPressed(document.getElementById("category-filters"), "category", state.category);
    setPressed(document.getElementById("prompt-filters"), "prompt", state.prompt);
    applyFilters();
  }

  async function start() {
    setupFilters();
    let payload;
    try {
      const response = await fetch("gallery.json");
      if (!response.ok) throw new Error(String(response.status));
      payload = await response.json();
    } catch (error) {
      grid.textContent = "The gallery index did not load.";
      return;
    }
    entries = payload.entries;
    const fragment = document.createDocumentFragment();
    entries.forEach((entry, index) => fragment.append(renderCard(entry, index)));
    grid.append(fragment);
    grid.querySelectorAll(".card").forEach((card) => observer.observe(card));
    const params = new URLSearchParams(location.search);
    const pinned = entries.find((entry) => entry.post_id === params.get("pin")) || entries[0];
    renderPin(pinned, false);
    readHash();
    applyFilters();
  }

  start();
})();
