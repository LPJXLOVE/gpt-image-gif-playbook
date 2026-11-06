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
  const HASH = {
    "games-and-pixel": "游戏与像素",
    "characters-and-stickers": "表情与角色",
    "brand-and-objects": "品牌与实物",
    "people-and-scenes": "人物与场景",
    "video-workflows": "视频流程",
  };

  const grid = document.getElementById("grid");
  const search = document.getElementById("search");
  const count = document.getElementById("count");
  const empty = document.getElementById("empty");
  const state = { category: "all", query: "" };
  let entries = [];

  const queue = [];
  let active = 0;
  const CONCURRENCY = 3;
  const FIRST = 9;

  function tweetSrc(id) {
    const src = `https://platform.twitter.com/embed/Tweet.html?id=${encodeURIComponent(id)}&dnt=true&lang=zh`;
    if (!src.includes("dnt=true") || src.includes("dnt=false")) throw new Error("dnt");
    return src;
  }

  function posterOf(entry) {
    return (entry.media.find((item) => item.preview_image_url) || entry.media[0]).preview_image_url;
  }

  function externalLink(href, text) {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = text;
    return a;
  }

  function visibleCards() {
    return [...grid.querySelectorAll(".card:not([hidden])")];
  }

  function applyFilters() {
    const q = state.query.trim().toLowerCase();
    let shown = 0;
    grid.querySelectorAll(".card").forEach((card) => {
      const entry = entries[Number(card.dataset.index)];
      const hay = [entry.title_zh, entry.publisher_handle, entry.publisher_name, entry.category].join("\n").toLowerCase();
      const ok = (state.category === "all" || entry.category === state.category) && (!q || hay.includes(q));
      card.hidden = !ok;
      if (ok) shown += 1;
    });
    count.textContent = shown + (shown === 1 ? " post" : " posts");
    empty.hidden = shown !== 0;
    visibleCards().forEach((card, index) => { card.tabIndex = index === 0 ? 0 : -1; });
    warmVisible();
  }

  function pump() {
    while (active < CONCURRENCY && queue.length) {
      const card = queue.shift();
      active += 1;
      mountFrame(card).finally(() => {
        active -= 1;
        pump();
      });
    }
  }

  function enqueue(card, priority) {
    if (!card || card.dataset.queued === "1" || card.dataset.mounted === "1") return;
    card.dataset.queued = "1";
    card.dataset.priority = String(priority);
    queue.push(card);
    queue.sort((a, b) => Number(a.dataset.priority) - Number(b.dataset.priority));
    pump();
  }

  function warmVisible() {
    visibleCards().slice(0, FIRST).forEach((card, index) => {
      const img = card.querySelector(".poster");
      if (img && img.dataset.src && !img.getAttribute("src")) img.src = img.dataset.src;
      enqueue(card, index);
    });
  }

  function mountFrame(card) {
    const frame = card.querySelector(".tweet");
    const id = card.dataset.postId;
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        card.dataset.mounted = "1";
        resolve();
      };
      frame.addEventListener("load", finish, { once: true });
      setTimeout(finish, 12000);
      frame.closest(".stage").classList.add("armed");
      frame.src = tweetSrc(id);
    });
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== "https://platform.twitter.com") return;
    let data = event.data;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch { return; }
    }
    const message = data && data["twttr.embed"];
    if (!message || message.method !== "twttr.private.resize") return;
    const box = message.params && message.params[0];
    const id = box && box.data && box.data.tweet_id;
    const height = box && box.height;
    if (!id || !height) return;
    const frame = grid.querySelector(`.tweet[data-post-id="${id}"]`);
    if (!frame || event.source !== frame.contentWindow) return;
    frame.style.height = `${height}px`;
    frame.closest(".stage").style.setProperty("--embed-h", `${height}px`);
    frame.closest(".stage").classList.add("has-embed");
    frame.closest(".card").dataset.mediaState = "embed";
  });

  function fillDetail(entry, panel) {
    if (entry.prompt_level === "完整") {
      const pre = document.createElement("pre");
      pre.textContent = entry.prompt_text;
      panel.append(pre);
      if (entry.prompt_file) panel.append(externalLink(REPO + entry.prompt_file, "Prompt file"));
    } else if (entry.prompt_level === "节选") {
      const quote = document.createElement("blockquote");
      quote.textContent = entry.excerpt;
      panel.append(quote);
    } else {
      const note = document.createElement("p");
      note.textContent = "No prompt was collected.";
      panel.append(note);
    }
  }

  function renderCard(entry, index) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.postId = entry.post_id;
    card.dataset.index = String(index);
    card.dataset.kind = entry.media_type === "video" ? "video" : "gif";
    card.dataset.mediaState = "poster";
    card.tabIndex = index === 0 ? 0 : -1;

    const stage = document.createElement("div");
    stage.className = "stage";
    const img = document.createElement("img");
    img.className = "poster";
    img.alt = "";
    img.decoding = "async";
    img.dataset.src = posterOf(entry);
    if (index < FIRST) img.src = img.dataset.src;
    const frame = document.createElement("iframe");
    frame.className = "tweet";
    frame.dataset.postId = entry.post_id;
    frame.title = entry.media_type === "video"
      ? `Video post by ${entry.publisher_handle}`
      : `GIF post by ${entry.publisher_handle}`;
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("loading", "lazy");
    stage.append(img, frame);

    const bar = document.createElement("div");
    bar.className = "bar";
    const title = document.createElement("h2");
    title.textContent = entry.title_zh;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = entry.media_type === "video" ? "Video" : "GIF";
    const open = externalLink(entry.canonical_post_url, "Open in X");
    open.className = "open";
    const prompt = document.createElement("button");
    prompt.type = "button";
    prompt.className = "prompt";
    prompt.textContent = "Prompt";
    prompt.setAttribute("aria-expanded", "false");
    const detail = document.createElement("div");
    detail.className = "detail";
    detail.hidden = true;
    fillDetail(entry, detail);
    prompt.addEventListener("click", () => {
      const openDetail = detail.hidden;
      detail.hidden = !openDetail;
      prompt.setAttribute("aria-expanded", openDetail ? "true" : "false");
    });
    bar.append(title, badge, open, prompt);
    card.append(stage, bar, detail);
    card.addEventListener("keydown", (event) => {
      if (event.target !== card) return;
      if (event.key === "Enter") {
        event.preventDefault();
        prompt.click();
      }
    });
    return card;
  }

  const observer = new IntersectionObserver((records) => {
    records.forEach((record) => {
      if (!record.isIntersecting) return;
      const card = record.target;
      const img = card.querySelector(".poster");
      if (img && img.dataset.src && !img.getAttribute("src")) img.src = img.dataset.src;
      const order = visibleCards().indexOf(card);
      enqueue(card, order < 0 ? 100 : order);
    });
  }, { rootMargin: "700px 0px" });

  function columnCount() {
    return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").length);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== search) {
      event.preventDefault();
      search.focus();
      return;
    }
    if (event.key === "Escape") {
      const open = grid.querySelector(".detail:not([hidden])");
      if (open) {
        open.hidden = true;
        open.parentElement.querySelector(".prompt").setAttribute("aria-expanded", "false");
      }
      return;
    }
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    if (document.activeElement === search) return;
    const cards = visibleCards();
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
    const bar = document.getElementById("category-filters");
    CATEGORIES.forEach(([id, label, hash]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.category = id;
      button.dataset.hash = hash;
      button.textContent = label;
      button.setAttribute("aria-pressed", id === "all" ? "true" : "false");
      button.addEventListener("click", () => {
        state.category = id;
        bar.querySelectorAll("button").forEach((item) => {
          item.setAttribute("aria-pressed", item.dataset.category === id ? "true" : "false");
        });
        history.replaceState(null, "", hash ? `#${hash}` : `${location.pathname}${location.search}`);
        applyFilters();
      });
      bar.append(button);
    });
    search.addEventListener("input", () => {
      state.query = search.value;
      applyFilters();
    });
    window.addEventListener("hashchange", () => {
      const category = HASH[location.hash.slice(1)];
      if (!category) return;
      state.category = category;
      bar.querySelectorAll("button").forEach((item) => {
        item.setAttribute("aria-pressed", item.dataset.category === category ? "true" : "false");
      });
      applyFilters();
    });
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
    entries.forEach((entry, index) => {
      const card = renderCard(entry, index);
      fragment.append(card);
    });
    grid.append(fragment);
    grid.querySelectorAll(".card").forEach((card) => observer.observe(card));
    const hashed = HASH[location.hash.slice(1)];
    if (hashed) {
      state.category = hashed;
      document.querySelectorAll("#category-filters button").forEach((item) => {
        item.setAttribute("aria-pressed", item.dataset.category === hashed ? "true" : "false");
      });
    }
    applyFilters();
  }

  start();
})();
