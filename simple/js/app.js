"use strict";

const CFG = window.MINIAPP_CONFIG;
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
const API = (CFG.apiBase || "") + "/api/v1/miniapp";

const state = {
  token: null,
  photoUrl: null,
  tab: "shop",
  profile: null,
  products: [],
  pollTimer: null,
  processingOrderId: null
};

// ==================== Утилиты ====================

function esc(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function haptic(type) {
  try {
    if (tg && tg.HapticFeedback) {
      if (type === "success" || type === "error") {
        tg.HapticFeedback.notificationOccurred(type);
      } else {
        tg.HapticFeedback.impactOccurred(type || "light");
      }
    }
  } catch (e) { /* игнорируем */ }
}

function toast(message, kind) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = "toast " + (kind === "error" ? "toast-error" : kind === "success" ? "toast-success" : "");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.add("hidden"), 3200);
}

function pluralDays(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return n + " день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return n + " дня";
  return n + " дней";
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function copyToClipboard(text, message) {
  const done = () => {
    haptic("success");
    toast(message || "Скопировано ✅", "success");
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => legacyCopy(text, done));
  } else {
    legacyCopy(text, done);
  }
}

function legacyCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { toast("Не удалось скопировать", "error"); }
  document.body.removeChild(ta);
}

function openTelegram(url) {
  if (tg && tg.openTelegramLink) {
    tg.openTelegramLink(url);
  } else {
    window.open(url, "_blank");
  }
}

function openExternal(url) {
  if (tg && tg.openLink) {
    tg.openLink(url);
  } else {
    window.open(url, "_blank");
  }
}

// ==================== API ====================

async function apiCall(path, method, body, isRetry) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers["Authorization"] = "Bearer " + state.token;

  let response;
  try {
    response = await fetch(API + path, {
      method: method || "GET",
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new Error("Нет связи с сервером. Проверьте интернет.");
  }

  if (response.status === 401 && !isRetry) {
    await authenticate();
    return apiCall(path, method, body, true);
  }

  let data = {};
  try { data = await response.json(); } catch (e) { /* пустой ответ */ }

  if (!response.ok || data.errorCode) {
    throw new Error(data.errorDescription || "Что-то пошло не так. Попробуйте ещё раз.");
  }

  return data;
}

async function authenticate() {
  if (!tg || !tg.initData) {
    throw new Error("gate");
  }
  const rs = await fetch(API + "/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData: tg.initData })
  });
  const data = await rs.json().catch(() => ({}));
  if (!rs.ok || data.errorCode) {
    throw new Error(data.errorDescription || "Не удалось войти. Откройте приложение через бота.");
  }
  state.token = data.token;
  state.photoUrl = data.user && data.user.photoUrl;
  try { localStorage.setItem("ds_miniapp_token", data.token); } catch (e) { /* приватный режим */ }
  return data;
}

async function loadAll() {
  const [profile, products] = await Promise.all([
    apiCall("/state"),
    apiCall("/products")
  ]);
  state.profile = profile;
  state.products = products;
}

// ==================== Запуск ====================

async function boot() {
  if (tg) {
    tg.ready();
    try { tg.expand(); } catch (e) { /* игнорируем */ }
    try { tg.setHeaderColor && tg.setHeaderColor("#0a0e17"); } catch (e) { /* игнорируем */ }
    try { tg.setBackgroundColor && tg.setBackgroundColor("#0a0e17"); } catch (e) { /* игнорируем */ }
  }

  if (!tg || !tg.initDataUnsafe || !tg.initDataUnsafe.user) {
    showGate("Это приложение работает только внутри Telegram.", true);
    return;
  }

  try {
    try { state.token = localStorage.getItem("ds_miniapp_token"); } catch (e) { /* игнорируем */ }
    if (!state.token) {
      await authenticate();
    }
    await loadAll();
    document.getElementById("gate").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    renderTopbar();
    renderTab(state.tab);
  } catch (e) {
    if (e.message === "gate") {
      showGate("Это приложение работает только внутри Telegram.", true);
    } else {
      showGate(e.message, false);
    }
  }
}

function showGate(text, showButton) {
  document.getElementById("gateText").textContent = text;
  document.getElementById("gateLoader").classList.add("hidden");
  const btn = document.getElementById("gateBtn");
  if (showButton) {
    btn.classList.remove("hidden");
    btn.onclick = () => openTelegram("https://t.me/" + CFG.botUsername);
  }
}

// ==================== Рендер каркаса ====================

function renderTopbar() {
  const user = state.profile && state.profile.user;
  const name = user && user.firstName ? user.firstName : "";
  const html = [];
  if (name) html.push('<div class="topbar-name">' + esc(name) + "</div>");
  if (state.photoUrl) {
    html.push('<img class="avatar" src="' + esc(state.photoUrl) + '" alt="">');
  } else {
    html.push('<div class="avatar">' + esc((name || "K").substring(0, 1).toUpperCase()) + "</div>");
  }
  document.getElementById("topbarUser").innerHTML = html.join("");
}

document.getElementById("tabbar").addEventListener("click", (e) => {
  const item = e.target.closest(".tabbar-item");
  if (!item) return;
  haptic("light");
  renderTab(item.dataset.tab);
});

function renderTab(tab) {
  stopPolling();
  closeSheet();
  state.tab = tab;
  document.querySelectorAll(".tabbar-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === tab);
  });
  const view = document.getElementById("view");
  if (tab === "shop") renderShop(view);
  if (tab === "keys") renderKeys(view);
  if (tab === "friends") renderFriends(view);
  if (tab === "help") renderHelp(view);
  view.scrollTop = 0;
  window.scrollTo(0, 0);
}

// ==================== Вью: Магазин ====================

function activeVpnOrder() {
  const orders = (state.profile && state.profile.orders) || [];
  return orders.find((o) => !o.isReferralGift && o.status === "DONE" && o.keyUrl && o.daysLeft > 0) || null;
}

function processingOrder() {
  const orders = (state.profile && state.profile.orders) || [];
  return orders.find((o) => !o.isReferralGift && o.status === "ACTIVE") || null;
}

function renderShop(view) {
  view.innerHTML = "";

  if (!state.profile) {
    view.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    loadAll()
      .then(() => renderShop(view))
      .catch((e) => toast(e.message, "error"));
    return;
  }

  const processing = processingOrder();
  const active = activeVpnOrder();

  if (processing) {
    view.appendChild(buildProcessingBanner(processing));
  }

  if (active) {
    view.appendChild(buildActiveCard(active));
    if (active.daysLeft <= 3) {
      view.appendChild(buildExpiringBanner(active));
    }
  } else if (!processing) {
    view.appendChild(buildWelcomeHero());
  }

  const tariffsTitle = document.createElement("div");
  tariffsTitle.className = "section-title";
  tariffsTitle.innerHTML = "<span>Тарифы</span>";
  view.appendChild(tariffsTitle);

  const tariffs = document.createElement("div");
  tariffs.className = "tariffs";
  state.products.forEach((product) => tariffs.appendChild(buildTariffCard(product)));
  view.appendChild(tariffs);

  view.appendChild(buildWhyBlock());
  view.appendChild(buildRefTeaser());
}

function buildWelcomeHero() {
  const freeAvailable = state.profile.freeAvailable;
  const el = document.createElement("div");
  el.className = "hero";
  el.innerHTML =
    '<div class="hero-emoji">🌍</div>' +
    '<div class="hero-title">Интернет без границ.<br>Уже через минуту.</div>' +
    '<div class="hero-sub">Серверы в Нидерландах 🇳🇱 · протокол Reality · до 500 Мбит/с</div>' +
    '<div class="hero-cta">' +
    (freeAvailable
      ? '<button class="btn btn-primary" id="heroFreeBtn">🍿 Попробовать бесплатно</button>'
      : '<button class="btn btn-primary" id="heroShopBtn">🔑 Выбрать тариф</button>') +
    "</div>" +
    '<div class="benefits">' +
    '<span class="chip">🇳🇱 Нидерланды</span>' +
    '<span class="chip">⚡ До 500 Мбит/с</span>' +
    '<span class="chip">🔒 Reality</span>' +
    '<span class="chip">📱 Все платформы</span>' +
    "</div>";

  const freeBtn = el.querySelector("#heroFreeBtn");
  if (freeBtn) {
    freeBtn.onclick = () => {
      haptic("light");
      const freeProduct = state.products.find((p) => p.isFree);
      if (freeProduct) openProductSheet(freeProduct);
    };
  }
  const shopBtn = el.querySelector("#heroShopBtn");
  if (shopBtn) {
    shopBtn.onclick = () => {
      haptic("light");
      const tariffs = document.querySelector(".tariffs");
      if (tariffs) tariffs.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }

  return el;
}

function buildActiveCard(order) {
  const daysWord = pluralDays(order.daysLeft).slice(String(order.daysLeft).length + 1);
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center">' +
    '<div><span class="chip chip-green">● VPN активен</span></div>' +
    '<div class="small muted">до ' + esc(formatDate(order.expiresAt)) + "</div>" +
    "</div>" +
    '<div class="sub-days" style="margin-top:12px">' + order.daysLeft + "<small>" + daysWord + " осталось</small></div>" +
    '<div class="progress"><div class="progress-fill' + (order.daysLeft <= 3 ? " warn" : "") + '" style="width:' + subProgress(order) + '%"></div></div>' +
    '<div class="key-box" style="display:none"><div class="key-text">' + esc(order.keyUrl) + '</div><button class="copy-btn">Копировать</button></div>' +
    '<div class="hero-cta" style="margin-top:10px">' +
    '<button class="btn btn-ghost show-key-btn">Показать ключ</button>' +
    '<button class="btn btn-primary go-tariffs-btn">Продлить</button>' +
    "</div>";

  el.querySelector(".copy-btn").onclick = () => copyToClipboard(order.keyUrl, "Ключ скопирован ✅");
  el.querySelector(".show-key-btn").onclick = () => {
    const box = el.querySelector(".key-box");
    box.style.display = box.style.display === "none" ? "flex" : "none";
  };
  el.querySelector(".go-tariffs-btn").onclick = () => {
    haptic("light");
    const tariffs = document.querySelector(".tariffs");
    if (tariffs) tariffs.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return el;
}

function subProgress(order) {
  const product = state.products.find((p) => p.title === order.title);
  const total = (product && product.durationDays) || (order.isFree ? 2 : 30);
  return Math.max(4, Math.min(100, Math.round((order.daysLeft / total) * 100)));
}

function buildExpiringBanner(order) {
  const el = document.createElement("div");
  el.className = "banner";
  el.innerHTML =
    '<div class="banner-text">⏳ Доступ истекает через ' + pluralDays(order.daysLeft) + ". Продли сейчас — и не теряй скорость.</div>" +
    '<button class="btn btn-primary btn-sm banner-renew">Продлить</button>';
  el.querySelector(".banner-renew").onclick = () => {
    haptic("light");
    const tariffs = document.querySelector(".tariffs");
    if (tariffs) tariffs.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return el;
}

function buildProcessingBanner(order) {
  const el = document.createElement("div");
  el.className = "banner";
  el.innerHTML =
    '<div class="banner-text">⏳ Заказ №' + order.id + " обрабатывается. Ключ появится здесь и придёт в бот.</div>" +
    '<button class="btn btn-ghost btn-sm" id="bannerRefresh">Обновить</button>';
  el.querySelector("#bannerRefresh").onclick = async () => {
    try {
      await loadAll();
      renderShop(document.getElementById("view"));
      toast("Обновлено", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  };
  return el;
}

function tariffBadge(product, index) {
  if (product.isFree) return '<span class="badge badge-free">СТАРТ · БЕСПЛАТНО</span>';
  const monthly = state.products.find((p) => !p.isFree && p.durationDays === 30);
  if (product.durationDays && product.durationDays > 100 && monthly && monthly.priceStars) {
    const saving = Math.round(100 - (product.priceStars / (monthly.priceStars * 6)) * 100);
    if (saving > 0) return '<span class="badge badge-best">ВЫГОДНО −' + saving + "%</span>";
  }
  if (product.durationDays === 30) return '<span class="badge badge-popular">ПОПУЛЯРНЫЙ</span>';
  return "";
}

function buildTariffCard(product) {
  const el = document.createElement("div");
  el.className = "tariff" + (product.durationDays === 30 ? " featured" : "");

  const title = product.isFree
    ? "2 дня бесплатно"
    : product.durationDays > 100
      ? "6 месяцев"
      : product.durationDays === 30
        ? "1 месяц"
        : "1 неделя";

  const perDay = product.isFree || !product.durationDays
    ? "Полный доступ без ограничений"
    : "≈ " + (product.priceStars / product.durationDays).toFixed(1).replace(".0", "") + " ⭐ в день";

  el.innerHTML =
    tariffBadge(product) +
    '<div class="tariff-left">' +
    '<div class="tariff-title">' + esc(title) + "</div>" +
    '<div class="tariff-perday">' + esc(perDay) + "</div>" +
    "</div>" +
    '<div class="tariff-price">' + (product.isFree ? "Бесплатно" : product.priceStars + ' <span class="star">⭐</span>') + "</div>";

  el.onclick = () => {
    haptic("light");
    openProductSheet(product);
  };

  return el;
}

function buildWhyBlock() {
  const el = document.createElement("div");
  el.innerHTML =
    '<div class="section-title">Почему мы</div>' +
    '<div class="why">' +
    '<div class="why-card"><div class="why-emoji">🇳🇱</div><div class="why-text">Серверы в ЕС, законы Нидерландов</div></div>' +
    '<div class="why-card"><div class="why-emoji">⚡</div><div class="why-text">До 500 Мбит/с, 4K без лагов</div></div>' +
    '<div class="why-card"><div class="why-emoji">🔒</div><div class="why-text">Reality — трафик как обычный HTTPS</div></div>' +
    "</div>";
  return el;
}

function buildRefTeaser() {
  const el = document.createElement("div");
  el.className = "card ref-teaser";
  el.innerHTML =
    '<div class="ref-teaser-emoji">🎁</div>' +
    '<div style="flex:1">' +
    '<div style="font-weight:800">+30 дней за каждого друга</div>' +
    '<div class="small muted" style="margin-top:3px">Друг получает 2 дня бесплатно</div>' +
    "</div>" +
    '<button class="btn btn-green btn-sm" id="teaserFriends">Пригласить</button>';
  el.querySelector("#teaserFriends").onclick = () => {
    haptic("light");
    renderTab("friends");
  };
  return el;
}

// ==================== Шторка тарифа ====================

function openProductSheet(product) {
  const sheet = document.getElementById("sheet");
  const backdrop = document.getElementById("sheetBackdrop");

  const title = product.isFree ? "🍿 Пробный период — 2 дня" : esc(
    product.durationDays > 100 ? "🔥 Доступ на 6 месяцев" :
    product.durationDays === 30 ? "🔑 Доступ на 1 месяц" :
    product.durationDays === 7 ? "⏳ Доступ на 1 неделю" : "VPN-подписка");

  sheet.innerHTML =
    '<div class="sheet-handle"></div>' +
    '<div class="sheet-title">' + title + "</div>" +
    '<div class="sheet-price">' +
    (product.isFree ? "Бесплатно" : product.priceStars + ' <span class="star">⭐</span>') +
    "</div>" +
    '<ul class="sheet-features">' +
    "<li>Полный доступ. Без ограничений и скрытых лимитов</li>" +
    "<li>Смотри YouTube, сиди в соцсетях, работай</li>" +
    "<li>Скорость как на самом дорогом тарифе</li>" +
    "<li>🇳🇱 Сервер в Нидерландах · 🔒 протокол Reality</li>" +
    "<li>Подключение за 60 секунд: iOS, Android, Windows</li>" +
    "</ul>" +
    '<button class="btn btn-primary" id="sheetBuyBtn">' +
    (product.isFree ? "Получить бесплатно" : "Оплатить " + product.priceStars + " ⭐") +
    "</button>" +
    (!product.isFree
      ? '<div class="center small muted" style="margin-top:12px">Не хватает звёзд? <a href="#" id="buyStarsLink" style="color:#9fe8ff;text-decoration:none">Где взять ⭐</a></div>'
      : "") +
    '<button class="btn btn-ghost" id="sheetCloseBtn" style="margin-top:10px">Закрыть</button>';

  backdrop.classList.remove("hidden");
  sheet.querySelector("#sheetCloseBtn").onclick = closeSheet;
  const starsLink = sheet.querySelector("#buyStarsLink");
  if (starsLink) {
    starsLink.onclick = (e) => {
      e.preventDefault();
      openTelegram(CFG.buyStarsUrl);
    };
  }
  sheet.querySelector("#sheetBuyBtn").onclick = () => buyProduct(product);

  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeSheet();
  };
}

function closeSheet() {
  document.getElementById("sheetBackdrop").classList.add("hidden");
}

// ==================== Покупка ====================

async function buyProduct(product) {
  if (product.isFree) {
    await createFreeOrder(product);
    return;
  }
  await startStarsPayment(product);
}

async function createFreeOrder(product) {
  try {
    const rs = await apiCall("/orders/free", "POST", { productId: product.id });
    haptic("success");
    closeSheet();
    showProcessingOverlay(rs.orderId, product);
  } catch (e) {
    toast(e.message, "error");
    haptic("error");
  }
}

async function startStarsPayment(product) {
  let invoice;
  try {
    invoice = await apiCall("/invoice", "POST", { productId: product.id });
  } catch (e) {
    toast(e.message, "error");
    haptic("error");
    return;
  }

  if (!tg || typeof tg.openInvoice !== "function") {
    toast("Оплата доступна только внутри Telegram", "error");
    return;
  }

  tg.openInvoice(invoice.invoiceUrl, async (status) => {
    if (status === "paid") {
      haptic("success");
      closeSheet();
      showConfirmLoop(invoice.invoiceRef, product);
    } else if (status === "failed") {
      haptic("error");
      toast("Оплата не прошла. Попробуйте ещё раз.", "error");
    } else {
      toast("Оплата не завершена", "error");
    }
  });
}

async function showConfirmLoop(invoiceRef, product) {
  showOverlay(
    '<div class="radar"><div class="radar-core"></div></div>' +
    '<div class="overlay-title">Подтверждаем оплату…</div>' +
    '<div class="overlay-text">Это займёт несколько секунд</div>'
  );

  let errors = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    let rs;
    try {
      rs = await apiCall("/invoice/confirm", "POST", { invoiceRef: invoiceRef });
      errors = 0;
    } catch (e) {
      errors++;
      if (errors >= 5) {
        hideOverlay();
        toast(e.message, "error");
        return;
      }
      continue;
    }
    if (rs.confirmed) {
      await loadAll();
      showProcessingOverlay(rs.orderId, product);
      return;
    }
  }

  hideOverlay();
  toast("Платёж обрабатывается Telegram. Если звёзды списались — заказ появится в разделе «Мои ключи».");
  renderTab("keys");
}

// ==================== Оверлей обработки заказа ====================

function showOverlay(innerHtml) {
  const overlay = document.getElementById("overlay");
  overlay.innerHTML = '<div class="overlay-inner">' + innerHtml + "</div>";
  overlay.classList.remove("hidden");
  if (tg && tg.BackButton) {
    tg.BackButton.show();
    tg.BackButton.onClick(() => {});
  }
}

function hideOverlay() {
  document.getElementById("overlay").classList.add("hidden");
  if (tg && tg.BackButton) tg.BackButton.hide();
}

function showProcessingOverlay(orderId, product) {
  state.processingOrderId = orderId;
  showOverlay(
    '<div class="radar"><div class="radar-core"></div></div>' +
    '<div class="overlay-title">Настраиваем сервер 🇳🇱</div>' +
    '<div class="overlay-text">Заказ №' + orderId + " принят.<br>Обычно это занимает меньше минуты — не закрывайте приложение.</div>"
  );

  let attempts = 0;
  stopPolling();
  state.pollTimer = setInterval(async () => {
    attempts++;
    try {
      await loadAll();
      const order = (state.profile.orders || []).find((o) => o.id === orderId);
      if (order && order.status === "DONE" && order.keyUrl) {
        stopPolling();
        state.processingOrderId = null;
        renderTopbar();
        showSuccessOverlay(order, product);
        return;
      }
      if (order && order.status !== "ACTIVE") {
        stopPolling();
        state.processingOrderId = null;
        hideOverlay();
        toast("Не удалось обработать заказ. Напишите в поддержку.", "error");
        return;
      }
    } catch (e) { /* сети нет — попробуем ещё */ }
    if (attempts > 36) {
      stopPolling();
      hideOverlay();
      toast("Заказ №" + orderId + " в обработке. Ключ придёт сообщением в бот.");
      renderTab("keys");
    }
  }, 5000);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function showSuccessOverlay(order, product) {
  haptic("success");
  launchConfetti();
  showOverlay(
    '<div class="overlay-emoji">🎉</div>' +
    '<div class="overlay-title">Готово! Заказ №' + order.id + "</div>" +
    '<div class="overlay-text">' + (order.isFree ? "2 дня полного доступа активированы" : esc(order.title) + " — доступ открыт") + "</div>" +
    '<div class="card" style="text-align:left;margin-top:18px">' +
    '<div class="small muted">Твой ключ (ссылка-подписка):</div>' +
    '<div class="key-box"><div class="key-text">' + esc(order.keyUrl) + '</div></div>' +
    '<button class="btn btn-primary" id="ovCopyBtn">Скопировать ключ</button>' +
    '<button class="btn btn-ghost" id="ovHelpBtn" style="margin-top:10px">Как подключить за 60 секунд</button>' +
    '<div class="card ref-teaser" style="margin:14px 0 0">' +
    '<div class="ref-teaser-emoji">🎁</div>' +
    '<div style="flex:1"><div style="font-weight:700;font-size:14px">Подари другу 2 дня — получи +30 дней</div></div>' +
    '<button class="btn btn-green btn-sm" id="ovShareBtn">Поделиться</button>' +
    "</div>" +
    "</div>"
  );

  document.getElementById("ovCopyBtn").onclick = () => copyToClipboard(order.keyUrl, "Ключ скопирован ✅");
  document.getElementById("ovHelpBtn").onclick = () => {
    hideOverlay();
    renderTab("help");
  };
  document.getElementById("ovShareBtn").onclick = () => {
    hideOverlay();
    renderTab("friends");
  };
}

function launchConfetti() {
  const colors = ["#6a5cff", "#22d3ee", "#2fd487", "#f5b940", "#ff7a45"];
  for (let i = 0; i < 46; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = Math.random() * 100 + "vw";
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = 2.4 + Math.random() * 1.6 + "s";
    piece.style.animationDelay = Math.random() * 0.7 + "s";
    piece.style.transform = "rotate(" + Math.random() * 360 + "deg)";
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 4200);
  }
}

// ==================== Вью: Мои ключи ====================

function renderKeys(view) {
  view.innerHTML = "";

  if (!state.profile) {
    view.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    loadAll()
      .then(() => renderKeys(view))
      .catch((e) => toast(e.message, "error"));
    return;
  }

  const orders = state.profile.orders || [];
  const vpnOrders = orders.filter((o) => !o.isReferralGift);
  const giftOrders = orders.filter((o) => o.isReferralGift);

  if (vpnOrders.length === 0 && giftOrders.length === 0) {
    view.innerHTML =
      '<div class="empty">' +
      '<div class="empty-emoji">🔑</div>' +
      '<div style="font-weight:700;margin-bottom:6px">Здесь появятся твои ключи</div>' +
      '<div class="small">Выбери тариф — и доступ откроется через минуту</div>' +
      '<button class="btn btn-primary" id="emptyShopBtn" style="margin-top:18px;max-width:240px">Выбрать тариф</button>' +
      "</div>";
    const btn = document.getElementById("emptyShopBtn");
    if (btn) btn.onclick = () => renderTab("shop");
    return;
  }

  vpnOrders.forEach((order) => view.appendChild(buildKeyCard(order)));

  if (giftOrders.length > 0) {
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = "🎁 Подарки за друзей";
    view.appendChild(title);
    giftOrders.forEach((order) => view.appendChild(buildGiftCard(order)));
  }
}

function keyStatus(order) {
  if (order.status === "ACTIVE") {
    return '<span class="chip chip-amber">⏳ Обрабатывается</span>';
  }
  if (order.status === "DONE" && order.daysLeft > 0) {
    return '<span class="chip chip-green">● Активна · ' + pluralDays(order.daysLeft) + "</span>";
  }
  if (order.status === "DONE") {
    return '<span class="chip chip-gray">Истекла</span>';
  }
  return '<span class="chip chip-gray">' + order.status + "</span>";
}

function buildKeyCard(order) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
    '<div style="font-weight:800">' + esc(order.title) + "</div>" +
    keyStatus(order) +
    "</div>" +
    (order.expiresAt
      ? '<div class="small muted" style="margin-top:6px">Действует до ' + esc(formatDate(order.expiresAt)) + "</div>"
      : "") +
    (order.keyUrl
      ? '<div class="key-box" style="display:none"><div class="key-text">' + esc(order.keyUrl) + '</div><button class="copy-btn">Копировать</button></div>'
      : "") +
    '<div class="hero-cta" style="margin-top:12px">' +
    (order.keyUrl
      ? '<button class="btn btn-ghost show-key-btn">Показать ключ</button>'
      : '<button class="btn btn-ghost refresh-btn">Обновить</button>') +
    (order.daysLeft > 0 && order.daysLeft <= 7
      ? '<button class="btn btn-primary go-shop-btn">Продлить</button>'
      : order.status === "DONE" ? '<button class="btn btn-primary go-shop-btn">Продлить</button>' : "") +
    "</div>";

  const copyBtn = el.querySelector(".copy-btn");
  if (copyBtn) copyBtn.onclick = () => copyToClipboard(order.keyUrl, "Ключ скопирован ✅");

  const showKeyBtn = el.querySelector(".show-key-btn");
  if (showKeyBtn) {
    showKeyBtn.onclick = () => {
      const box = el.querySelector(".key-box");
      box.style.display = box.style.display === "none" ? "flex" : "none";
    };
  }

  const refreshBtn = el.querySelector(".refresh-btn");
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      try {
        await loadAll();
        renderKeys(document.getElementById("view"));
        toast("Обновлено", "success");
      } catch (e) {
        toast(e.message, "error");
      }
    };
  }

  const goShop = el.querySelector(".go-shop-btn");
  if (goShop) goShop.onclick = () => renderTab("shop");

  return el;
}

function buildGiftCard(order) {
  const el = document.createElement("div");
  el.className = "card";
  const received = order.status === "DONE";
  el.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
    '<div style="font-weight:800">🎁 +30 дней за друга</div>' +
    (received
      ? '<span class="chip chip-green">Получено</span>'
      : '<span class="chip chip-amber">Начисляется</span>') +
    "</div>" +
    '<div class="small muted" style="margin-top:6px">' +
    (received ? "30 дней добавлены к твоей подписке" : "Друг оплатил подписку — бонус обрабатывается") +
    "</div>";
  return el;
}

// ==================== Вью: Друзья ====================

function renderFriends(view) {
  view.innerHTML = "";

  if (!state.profile) {
    view.innerHTML = '<div class="skeleton"></div>';
    loadAll()
      .then(() => renderFriends(view))
      .catch((e) => toast(e.message, "error"));
    return;
  }

  const ref = state.profile.referral || {};
  const inviteLink = ref.inviteLink || "";

  const hero = document.createElement("div");
  hero.className = "hero";
  hero.innerHTML =
    '<div class="hero-emoji">🎁</div>' +
    '<div class="hero-title">Дари VPN —<br>получай месяцы</div>' +
    '<div class="hero-sub">Каждый друг, оплативший подписку, приносит тебе <b>+30 дней</b>. Сколько друзей — столько и месяцев. Лимита нет.</div>' +
    '<div class="hero-cta">' +
    '<button class="btn btn-green" id="shareBtn">📤 Поделиться ссылкой</button>' +
    '<button class="btn btn-ghost" id="copyLinkBtn">Скопировать</button>' +
    "</div>";
  view.appendChild(hero);

  const stats = document.createElement("div");
  stats.className = "stat-grid";
  stats.innerHTML =
    '<div class="stat-card"><div class="stat-value">' + (ref.invitedCount || 0) + '</div><div class="stat-label">друзей пришло</div></div>' +
    '<div class="stat-card"><div class="stat-value" style="color:#6ff0b4">' + (ref.giftedDays || 0) + '</div><div class="stat-label">дней подарено</div></div>' +
    '<div class="stat-card"><div class="stat-value" style="color:#ffcf8e">' + (ref.pendingGifts || 0) + '</div><div class="stat-label">начисляется</div></div>';
  view.appendChild(stats);

  const linkCard = document.createElement("div");
  linkCard.className = "card";
  linkCard.innerHTML =
    '<div style="font-weight:800;margin-bottom:4px">Твоя персональная ссылка</div>' +
    '<div class="small muted">Друг заходит по ней и получает 2 дня бесплатно</div>' +
    '<div class="link-box"><div class="link-text">' + esc(inviteLink) + '</div><button class="copy-btn" id="linkCopy2">Копировать</button></div>';
  view.appendChild(linkCard);

  const how = document.createElement("div");
  how.className = "card";
  how.innerHTML =
    '<div style="font-weight:800;margin-bottom:6px">Как это работает</div>' +
    '<div class="steps">' +
    '<div class="step"><div class="step-num"></div><div class="step-text">Отправь ссылку другу — в чат, сторис или куда угодно</div></div>' +
    '<div class="step"><div class="step-num"></div><div class="step-text">Друг получает <b>2 дня VPN бесплатно</b>, без карт и обязательств</div></div>' +
    '<div class="step"><div class="step-num"></div><div class="step-text">Он оплачивает подписку — тебе летит <b>+30 дней</b> 🎉</div></div>' +
    "</div>";
  view.appendChild(how);

  const shareText = "🔓 VPN без границ: 2 дня бесплатно по моей ссылке 👇";

  hero.querySelector("#shareBtn").onclick = () => {
    haptic("light");
    openTelegram(
      "https://t.me/share/url?url=" + encodeURIComponent(inviteLink) + "&text=" + encodeURIComponent(shareText)
    );
  };
  const copyLink = (btnId) => {
    const btn = view.querySelector(btnId);
    if (btn) btn.onclick = () => copyToClipboard(inviteLink, "Ссылка скопирована ✅");
  };
  copyLink("#copyLinkBtn");
  copyLink("#linkCopy2");
}

// ==================== Вью: Помощь ====================

function renderHelp(view) {
  view.innerHTML = "";

  const steps = document.createElement("div");
  steps.className = "card";
  steps.innerHTML =
    '<div style="font-weight:800;margin-bottom:6px">🚀 Настройка за 60 секунд</div>' +
    '<div class="steps">' +
    '<div class="step"><div class="step-num"></div><div class="step-text"><b>Установи приложение</b> — Happ, V2RayTun или Karing (ссылки ниже)</div></div>' +
    '<div class="step"><div class="step-num"></div><div class="step-text"><b>Скопируй ключ</b> — кнопка «Показать ключ» в разделе «Мои ключи»</div></div>' +
    '<div class="step"><div class="step-num"></div><div class="step-text"><b>Добавь в приложение:</b> открой его → нажми ⊕ → «Вставить из буфера»</div></div>' +
    '<div class="step"><div class="step-num"></div><div class="step-text"><b>Нажми «Подключиться»</b> 🔓 — и ты в интернете без границ</div></div>' +
    "</div>" +
    '<div class="small muted" style="margin-top:10px">Не забывай обновлять подписку в приложении (кнопка 🔄), чтобы иметь самый актуальный доступ.</div>';
  view.appendChild(steps);

  const apps = document.createElement("div");
  apps.className = "card";
  apps.innerHTML =
    '<div class="platform-title">📱 iOS</div>' +
    '<div class="app-links">' +
    '<a class="app-link" href="#" data-url="https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973">Happ</a>' +
    '<a class="app-link" href="#" data-url="https://apps.apple.com/ru/app/karing/id6472431552">Karing</a>' +
    '<a class="app-link" href="#" data-url="https://apps.apple.com/us/app/v2raytun/id6476628951">V2RayTun</a>' +
    "</div>" +
    '<div class="platform-title">🤖 Android</div>' +
    '<div class="app-links">' +
    '<a class="app-link" href="#" data-url="https://play.google.com/store/apps/details?id=com.happproxy">Happ</a>' +
    '<a class="app-link" href="#" data-url="https://play.google.com/store/apps/details?id=com.v2raytun.android">V2RayTun</a>' +
    "</div>" +
    '<div class="platform-title">💻 Windows</div>' +
    '<div class="app-links">' +
    '<a class="app-link" href="#" data-url="https://storage.v2raytun.com/v2RayTun_Setup.exe">V2RayTun</a>' +
    '<a class="app-link" href="#" data-url="https://github.com/InvisibleManVPN/InvisibleMan-XRayClient/releases/download/v3.2.5/InvisibleManXRay-x64.zip">InvisibleMan</a>' +
    "</div>";
  apps.querySelectorAll(".app-link").forEach((link) => {
    link.onclick = (e) => {
      e.preventDefault();
      openExternal(link.dataset.url);
    };
  });
  view.appendChild(apps);

  const routing = document.createElement("div");
  routing.className = "card";
  routing.innerHTML =
    '<div class="platform-title" style="margin-top:0">🌐 Маршрутизация (RU-сайты без VPN)</div>' +
    '<div class="app-links">' +
    '<a class="app-link" href="#" data-url="https://routing.help/">Для Happ</a>' +
    '<a class="app-link" href="#" data-url="https://incy.routing.help/">Для INCY</a>' +
    "</div>" +
    '<div class="small muted" style="margin-top:8px">Открой ссылку на устройстве с VPN и примени настройки. Затем выключи и включи VPN.</div>';
  routing.querySelectorAll(".app-link").forEach((link) => {
    link.onclick = (e) => {
      e.preventDefault();
      openExternal(link.dataset.url);
    };
  });
  view.appendChild(routing);

  const support = document.createElement("div");
  support.className = "card";
  support.innerHTML =
    '<button class="btn btn-ghost" id="buyStarsHelp">⭐ Где купить звёзды</button>' +
    '<button class="btn btn-ghost" id="supportBtn" style="margin-top:10px">💬 Написать в поддержку</button>';
  support.querySelector("#buyStarsHelp").onclick = () => openTelegram(CFG.buyStarsUrl);
  support.querySelector("#supportBtn").onclick = () => openTelegram(CFG.supportUrl);
  view.appendChild(support);
}

// ==================== Кнопка поддержки ====================

document.getElementById("supportFab").addEventListener("click", () => {
  haptic("light");
  openTelegram(CFG.supportUrl);
});

// ==================== Старт ====================

boot();
