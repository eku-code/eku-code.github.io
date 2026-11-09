// Логика мини-приложения демо-бота (папка miniapp/, деплоится на GitHub Pages).
// Приложение работает только внутри Telegram: авторизация по initData (концепция digital_store).

(function () {
  'use strict';

  var CFG = window.MINIAPP_CONFIG || {};
  var D = window.DEMO_DATA;
  var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  var API = (CFG.apiBase || '') + '/api/demo';
  var TOKEN_STORAGE_KEY = 'loyalty_demo_token';
  var state = {
    token: null,
    tab: 'demo',
    adminPage: 'dash',
    cards: D.cards.slice(),
    selectedCardIndex: 0,
    cashType: 'PLUS',
    themeColor: D.themeColors[0]
  };

  // ===== Авторизация (Telegram initData -> сессионный токен бэкенда) =====

  function authenticate() {
    if (!tg || !tg.initData) {
      return Promise.reject(new Error('gate'));
    }
    return fetch(API + '/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok || data.errorCode) {
          throw new Error(data.errorDescription || 'Не удалось войти. Откройте приложение через бота.');
        }
        state.token = data.token;
        try { localStorage.setItem(TOKEN_STORAGE_KEY, data.token); } catch (e) { /* приватный режим */ }
        return data;
      });
    });
  }

  function apiCall(path, method, body, isRetry) {
    var headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;

    return fetch(API + path, {
      method: method || 'GET',
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 401 && !isRetry) {
        // Токен истёк - переавторизуемся и повторяем запрос один раз
        return authenticate().then(function () { return apiCall(path, method, body, true); });
      }
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok || data.errorCode) {
          throw new Error(data.errorDescription || data.message || 'Что-то пошло не так. Попробуйте ещё раз.');
        }
        return data;
      });
    });
  }

  // ===== Экран-заглушка (вне Telegram приложение не открывается) =====

  function showGate(text, showButton) {
    document.getElementById('gateText').textContent = text;
    var loader = document.getElementById('gateLoader');
    if (loader) loader.classList.add('hidden');
    var btn = document.getElementById('gateBtn');
    if (btn && showButton) {
      btn.classList.remove('hidden');
      btn.onclick = function () {
        var url = 'https://t.me/' + (CFG.botUsername || '');
        if (tg && tg.openTelegramLink) { tg.openTelegramLink(url); }
        else { window.location.href = url; }
      };
    }
  }

  // Открываем вкладку по hash (#demo / #order / #reviews)
  var initialTab = (location.hash || '#demo').substring(1);
  if (['demo', 'order', 'reviews'].indexOf(initialTab) === -1) initialTab = 'demo';

  // ===== Табы =====
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
  });

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === tab); });
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + tab); });
    if (tab === 'analytics' || tab === 'demo') renderCharts();
  }

  // ===== Разделы слепка админки =====
  document.querySelectorAll('.admin-nav button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.adminPage = btn.dataset.page;
      document.querySelectorAll('.admin-nav button').forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.querySelectorAll('.admin-page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + btn.dataset.page); });
    });
  });

  // ===== Дашборд =====
  function renderKpi() {
    var icons = { users: 'fa-users', card: 'fa-address-card', wallet: 'fa-wallet', star: 'fa-star' };
    document.getElementById('kpiGrid').innerHTML = D.kpi.map(function (k) {
      return '<div class="kpi">' +
        '<div class="kpi-label">' + k.label + '</div>' +
        '<div class="kpi-value">' + k.value + '</div>' +
        '<div class="kpi-delta"><i class="fas ' + (icons[k.icon] || 'fa-chart-line') + '"></i> ' + k.delta + '</div>' +
        '</div>';
    }).join('');
  }

  function renderTransactions() {
    document.getElementById('txList').innerHTML = D.transactions.map(function (t) {
      var isPlus = t.type === 'PLUS';
      return '<div class="tx">' +
        '<span class="tx-icon ' + (isPlus ? 'plus' : 'minus') + '"><i class="fas ' + (isPlus ? 'fa-arrow-up' : 'fa-arrow-down') + '"></i></span>' +
        '<div class="tx-main"><div class="tx-name">' + t.name + '</div><div class="tx-sub">' + t.time + ' · карта ' + t.card + '</div></div>' +
        '<div class="tx-amount"><div class="tx-sum">' + t.amount + ' ₽</div>' +
        '<div class="tx-change ' + (isPlus ? 'plus' : 'minus') + '">' + t.change + ' балл' + (Math.abs(parseInt(t.change)) % 10 === 1 && Math.abs(parseInt(t.change)) !== 11 ? '' : 'ов') + '</div></div>' +
        '</div>';
    }).join('');
  }

  // ===== Карты =====
  function renderCards() {
    var q = (document.getElementById('cardSearch').value || '').toLowerCase();
    var list = state.cards.filter(function (c) {
      return !q || (c.name + ' ' + c.phone + ' ' + c.number).toLowerCase().indexOf(q) !== -1;
    });
    document.getElementById('cardsTableBody').innerHTML = list.length ? list.map(function (c) {
      return '<tr>' +
        '<td class="card-num">' + c.number + '</td>' +
        '<td><b>' + c.name + '</b><br><span style="color:var(--muted);font-size:11.5px">' + c.phone + '</span></td>' +
        '<td>' + c.cashback + '%</td>' +
        '<td><b>' + c.balance + '</b></td>' +
        '<td>' + c.sum.toLocaleString('ru-RU') + ' ₽</td>' +
        '<td><span class="badge ' + (c.active ? 'on' : 'off') + '">' + (c.active ? 'активна' : 'выключена') + '</span>' +
        (c.trusted ? '<span class="badge trust">доверенный</span>' : '') + '</td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:24px">Ничего не найдено</td></tr>';
  }
  document.getElementById('cardSearch').addEventListener('input', renderCards);

  // ===== Касса =====
  function renderCashier() {
    var select = document.getElementById('cashCardSelect');
    select.innerHTML = state.cards.map(function (c, i) {
      return '<option value="' + i + '">' + c.number + ' — ' + c.name + '</option>';
    }).join('');
    select.value = state.selectedCardIndex;
    renderCashierPreview();
  }

  function renderCashierPreview() {
    var c = state.cards[state.selectedCardIndex];
    if (!c) return;
    document.getElementById('pvCashback').textContent = c.cashback + '%';
    document.getElementById('pvNumber').textContent = c.number;
    document.getElementById('pvName').textContent = c.name;
    document.getElementById('pvBalance').textContent = c.balance + ' баллов';
  }

  document.getElementById('cashCardSelect').addEventListener('change', function () {
    state.selectedCardIndex = parseInt(this.value, 10) || 0;
    renderCashierPreview();
  });

  document.querySelectorAll('#cashType button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.cashType = b.dataset.type;
      document.querySelectorAll('#cashType button').forEach(function (x) { x.classList.toggle('active', x === b); });
    });
  });

  document.getElementById('cashSubmit').addEventListener('click', function () {
    var amount = parseFloat(document.getElementById('cashAmount').value);
    if (!amount || amount <= 0) { showToast('Введите сумму покупки'); return; }

    var c = state.cards[state.selectedCardIndex];
    var resultBox = document.getElementById('cashResult');
    resultBox.classList.remove('d-none');

    if (state.cashType === 'PLUS') {
      var points = Math.round(amount * c.cashback / 100);
      c.balance += points; c.sum += amount;
      resultBox.innerHTML = '<b>Начислено ' + points + ' баллов</b> (' + c.cashback + '% от ' + amount + ' ₽)<br>Новый баланс: <b>' + c.balance + '</b> баллов';
      D.transactions.unshift({ time: currentTime(), card: c.number, name: c.name, type: 'PLUS', amount: amount, change: '+' + points });
    } else {
      if (c.balance < amount) { showToast('Недостаточно баллов на карте'); resultBox.classList.add('d-none'); return; }
      c.balance -= Math.round(amount);
      resultBox.innerHTML = '<b>Списано ' + Math.round(amount) + ' баллов</b><br>Новый баланс: <b>' + c.balance + '</b> баллов<br>К оплате: <b>' + (amount - Math.round(amount)) + ' ₽</b>';
      D.transactions.unshift({ time: currentTime(), card: c.number, name: c.name, type: 'MINUS', amount: amount, change: '−' + Math.round(amount) });
    }

    renderCashierPreview();
    renderCards();
    renderTransactions();
    document.getElementById('cashAmount').value = '';
  });

  // ===== Аналитика =====
  function renderCharts() {
    var bars = document.getElementById('revenueBars');
    if (!bars || bars.dataset.rendered) return;

    bars.innerHTML = D.revenueByMonth.map(function (m) {
      return '<div class="bar-col"><div class="bar" style="height:0" data-h="' + m.v + '"></div><span>' + m.m + '</span></div>';
    }).join('');
    setTimeout(function () {
      bars.querySelectorAll('.bar').forEach(function (b) { b.style.height = b.dataset.h + '%'; });
    }, 60);

    var maxSplit = Math.max.apply(null, D.cashbackSplit.map(function (s) { return s.count; }));
    document.getElementById('cashbackBars').innerHTML = D.cashbackSplit.map(function (s) {
      return '<div class="hbar-row"><span>' + s.label + '</span>' +
        '<div class="hbar-track"><div class="hbar-fill" style="width:' + Math.round(s.count / maxSplit * 100) + '%"></div></div>' +
        '<span class="hbar-count">' + s.count + '</span></div>';
    }).join('');

    var heat = document.getElementById('heatmap');
    var html = '';
    for (var day = 0; day < 7; day++) {
      for (var h = 0; h < 12; h++) {
        var v = D.heatmap[day][h];
        var alpha = v === 0 ? 0.06 : 0.15 + v * 0.085;
        html += '<i style="background:rgba(124,58,237,' + alpha.toFixed(2) + ')"></i>';
      }
    }
    heat.innerHTML = html;
    var legend = document.querySelector('.heat-legend');
    if (legend) legend.querySelectorAll('i').forEach(function (el, i) {
      el.style.background = 'rgba(124,58,237,' + (0.15 + i * 0.25) + ')';
    });
    bars.dataset.rendered = '1';
  }

  // ===== Заказ =====
  function renderSwatches() {
    document.getElementById('swatches').innerHTML = D.themeColors.map(function (color, i) {
      return '<div class="swatch' + (i === 0 ? ' selected' : '') + '" data-color="' + color + '" style="background:' + color + '"></div>';
    }).join('');

    document.querySelectorAll('.swatch').forEach(function (s) {
      s.addEventListener('click', function () {
        document.querySelectorAll('.swatch').forEach(function (x) { x.classList.toggle('selected', x === s); });
        state.themeColor = s.dataset.color;
        document.getElementById('orderCustomColor').value = s.dataset.color;
        applyOrderPreview();
      });
    });
  }

  document.getElementById('orderCustomColor').addEventListener('input', function () {
    state.themeColor = this.value;
    document.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('selected'); });
    applyOrderPreview();
  });

  document.getElementById('orderStoreName').addEventListener('input', applyOrderPreview);

  function applyOrderPreview() {
    document.documentElement.style.setProperty('--accent', state.themeColor);
    var card = document.getElementById('orderPreviewCard');
    card.style.setProperty('--card-accent', state.themeColor);
    var name = document.getElementById('orderStoreName').value.trim().toUpperCase() || 'ВАШ МАГАЗИН';
    document.getElementById('opBrand').textContent = name.substring(0, 22);
  }

  document.getElementById('orderPay').addEventListener('click', function () {
    hideOrderError();
    var storeName = document.getElementById('orderStoreName').value.trim();
    if (storeName.length < 2) { showOrderError('Укажите название вашего магазина'); return; }

    var btn = document.getElementById('orderPay');
    btn.disabled = true;

    // Пользователь Telegram определяется бэкендом из провалидированного initData
    apiCall('/order', 'POST', {
      storeName: storeName,
      themeColor: state.themeColor
    }).then(function (result) {
      btn.disabled = false;
      if (!result.success) { showOrderError(result.message || 'Не удалось создать заказ'); return; }
      document.getElementById('orderSuccess').classList.remove('d-none');

      if (result.invoiceLink && tg && tg.openInvoice) {
        tg.openInvoice(result.invoiceLink, function (status) {
          if (status === 'paid') {
            document.getElementById('orderSuccess').innerHTML =
              '<i class="fas fa-circle-check"></i><div><b>Оплата прошла успешно!</b><br>Заказ №' + result.orderId +
              ' принят.<br>Логин для входа отправлен вам в чат — задайте пароль при первом входе.<br><br>' +
              '<a href="' + CFG.apiBase + '/login" style="color:#a78bfa;font-weight:700">Открыть сайт системы →</a></div>';
            showToast('Спасибо за заказ!');
          } else if (status === 'failed') {
            showOrderError('Оплата не прошла. Попробуйте ещё раз.');
          }
        });
      } else {
        showOrderError(result.paymentMessage || 'Оплата временно недоступна — заказ сохранён, мы свяжемся с вами.');
      }
    }).catch(function (error) {
      btn.disabled = false;
      showOrderError((error && error.message) || 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
    });
  });

  function showOrderError(text) {
    var box = document.getElementById('orderError');
    box.textContent = text;
    box.classList.remove('d-none');
  }
  function hideOrderError() { document.getElementById('orderError').classList.add('d-none'); }

  // ===== Отзывы =====
  function renderReviews() {
    var palettes = ['#7c3aed', '#2f80ed', '#3fae6a', '#b5762a', '#d53369', '#12a5a5', '#e2b93b'];
    document.getElementById('reviewsGrid').innerHTML = D.reviews.map(function (r, i) {
      var initials = r.name.split(' ').map(function (p) { return p[0]; }).join('');
      return '<div class="review" style="animation-delay:' + (i * 0.04) + 's">' +
        '<div class="review-head">' +
        '<span class="avatar" style="background:' + palettes[i % palettes.length] + '">' + initials + '</span>' +
        '<div><div class="review-name">' + r.name + '</div><div class="review-role">' + r.role + '</div></div>' +
        '<span class="review-stars">★★★★★</span>' +
        '</div><div class="review-text">' + r.text + '</div></div>';
    }).join('');
  }

  // ===== Утилиты =====
  function showToast(text) {
    var t = document.getElementById('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function currentTime() {
    return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  // ===== Старт: приложение открывается только из Telegram =====

  function startApp() {
    renderKpi();
    renderTransactions();
    renderCards();
    renderCashier();
    renderSwatches();
    renderReviews();
    applyOrderPreview();
    switchTab(initialTab);
  }

  function boot() {
    if (tg) {
      tg.ready();
      try { tg.expand(); } catch (e) { /* игнорируем */ }
    }

    // Вне Telegram нет initData - показываем заглушку с кнопкой «Открыть бота»
    if (!tg || !tg.initDataUnsafe || !tg.initDataUnsafe.user) {
      showGate('Это приложение работает только внутри Telegram.', true);
      return;
    }

    var user = tg.initDataUnsafe.user;
    if (user.first_name) {
      document.getElementById('tgUserName').textContent = 'Привет, ' + user.first_name + '! Демо для владельцев кофеен и магазинов';
    }

    try { state.token = localStorage.getItem(TOKEN_STORAGE_KEY); } catch (e) { /* приватный режим */ }

    var authPromise = state.token ? Promise.resolve() : authenticate();
    authPromise.then(function () {
      document.getElementById('gate').classList.add('hidden');
      startApp();
    }).catch(function (e) {
      if (e && e.message === 'gate') {
        showGate('Это приложение работает только внутри Telegram.', true);
      } else {
        showGate((e && e.message) || 'Не удалось войти. Откройте приложение через бота.', false);
      }
    });
  }

  boot();
})();
