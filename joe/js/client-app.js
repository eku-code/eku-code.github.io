// Логика клиентского мини-приложения «Табачный Джо» (store_id = 1, только внутри Telegram).
// Авторизация: POST /api/client/auth с Telegram initData (подпись проверяется бэкендом токеном
// клиентского бота) -> сессионный Bearer-токен. Дальше API /api/client/**: карта, выпуск, QR.

(function () {
    'use strict';

    var CFG = window.CLIENT_APP_CONFIG || {};
    var API = (CFG.apiBase || '').replace(/\/$/, '');
    var STORE_ID = CFG.storeId || 1;
    var TOKEN_KEY = 'tj_client_token_' + STORE_ID;

    var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

    var sessionToken = null;
    var qrObjectUrl = null;

    // ===================== Утилиты =====================

    function $(id) { return document.getElementById(id); }

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function plural(n, one, few, many) {
        var mod10 = n % 10, mod100 = n % 100;
        if (mod10 === 1 && mod100 !== 11) return one;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
        return many;
    }

    function haptic(type) {
        try {
            if (tg && tg.HapticFeedback) {
                if (type === 'success' || type === 'error') tg.HapticFeedback.notificationOccurred(type);
                else tg.HapticFeedback.impactOccurred('light');
            }
        } catch (e) { /* вне Telegram — игнорируем */ }
    }

    var toastTimer = null;
    function toast(message, kind) {
        var el = $('toast');
        el.textContent = message;
        el.className = 'toast show ' + (kind || '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.className = 'toast'; }, 3200);
    }

    function setLoading(button, loading) {
        if (!button) return;
        button.disabled = loading;
        if (loading) button.classList.add('loading');
        else button.classList.remove('loading');
    }

    // ===================== Гейт и авторизация =====================

    function showGate(text, showButton) {
        $('gateText').textContent = text;
        $('gateLoader').classList.toggle('d-none', !!showButton);
        $('gateBtn').classList.toggle('d-none', !showButton);
        $('gate').classList.add('open');
    }

    function hideGate() {
        $('gate').classList.remove('open');
    }

    function isInsideTelegram() {
        return !!tg && !!tg.initData && tg.initData.length > 0;
    }

    function authorize() {
        if (!isInsideTelegram()) {
            showGate('Приложение доступно только внутри Telegram. Откройте его через бота.', true);
            return Promise.reject();
        }

        return fetch(API + '/api/client/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData: tg.initData })
        }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (data) {
                if (!response.ok) {
                    throw new Error(data.errorDescription || data.message || 'Ошибка авторизации');
                }
                return data;
            });
        }).then(function (data) {
            sessionToken = data.token;
            try { sessionStorage.setItem(TOKEN_KEY, sessionToken); } catch (e) { /* ignore */ }
            hideGate();
            return data.user || {};
        }).catch(function (error) {
            showGate((error && error.message) || 'Не удалось войти. Попробуйте позже.', true);
            throw error;
        });
    }

    // Все запросы API — с Bearer-токеном; при 401 перепроходим авторизацию один раз
    function api(path, options, retried) {
        options = options || {};
        options.headers = Object.assign({ 'Authorization': 'Bearer ' + sessionToken }, options.headers || {});

        return fetch(API + path, options).then(function (response) {
            if (response.status === 401 && !retried) {
                return authorize().then(function () { return api(path, options, true); });
            }
            return response;
        });
    }

    // ===================== Telegram =====================

    function initTelegram() {
        if (!tg) return;

        tg.ready();
        tg.expand();

        // Тёмная тема Telegram
        if ((tg.colorScheme || 'light') === 'dark') document.body.classList.add('tg-dark');
        try {
            tg.onEvent('themeChanged', function () {
                document.body.classList.toggle('tg-dark', (tg.colorScheme || 'light') === 'dark');
            });
        } catch (e) { /* старые версии SDK */ }

        try {
            if (tg.setHeaderColor) tg.setHeaderColor('#1b4332');
            if (tg.setBackgroundColor) tg.setBackgroundColor((tg.colorScheme || 'light') === 'dark' ? '#17212b' : '#f4f6f4');
        } catch (e) { /* ignore */ }
    }

    // ===================== Экран «Моя карта» =====================

    function cashbackText(card) {
        var c = card && card.cashback;
        if (c === null || c === undefined || c === '') return '3%';
        return String(c).indexOf('%') === -1 ? c + '%' : String(c);
    }

    function renderMyCard(card) {
        $('headerCashback').querySelector('span').textContent = cashbackText(card);

        if (!card) {
            $('cardEmpty').classList.remove('d-none');
            $('cardReady').classList.add('d-none');
            return;
        }

        $('cardEmpty').classList.add('d-none');
        $('cardReady').classList.remove('d-none');

        $('lcCashback').textContent = cashbackText(card);
        $('lcNumber').textContent = card.cardNumber || '—';
        $('lcHolder').textContent = card.clientName || 'Клиент';
        $('lcBalance').textContent = Number(card.balance || 0).toLocaleString('ru-RU');
        $('lcBalanceLabel').textContent = plural(Math.abs(Number(card.balance || 0)), 'балл', 'балла', 'баллов');
        loadQr($('lcQr'));
    }

    function loadMyCard() {
        return api('/api/client/card?storeId=' + STORE_ID)
            .then(function (response) { return response.json(); })
            .then(function (data) {
                if (!data.success) throw new Error(data.message);
                renderMyCard(data.hasCard ? data.card : null);
            })
            .catch(function (error) {
                if (error) toast('Не удалось загрузить карту: ' + (error.message || 'ошибка сети'), 'error');
            });
    }

    function refreshCard() {
        setLoading($('refreshCard'), true);
        loadMyCard()
            .then(function () { haptic('success'); toast('Баланс обновлён', 'success'); })
            .finally(function () { setLoading($('refreshCard'), false); });
    }

    // QR собственной карты: загружается с токеном и показывается через blob-URL
    function loadQr(imgEl) {
        api('/api/client/card/qr?storeId=' + STORE_ID)
            .then(function (response) {
                if (!response.ok) throw new Error('QR недоступен');
                return response.blob();
            })
            .then(function (blob) {
                if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl);
                qrObjectUrl = URL.createObjectURL(blob);
                imgEl.src = qrObjectUrl;
            })
            .catch(function () { /* QR покажет пустой alt */ });
    }

    // ===================== Выпуск карты =====================

    function initPhoneMask() {
        var input = $('issPhone');
        input.addEventListener('input', function () {
            var d = this.value.replace(/\D/g, '');
            if (d[0] === '8') d = '7' + d.slice(1);
            if (d[0] !== '7') d = '7' + d;
            d = d.slice(0, 11);

            var out = '';
            if (d.length > 0) out = '+7';
            if (d.length > 1) out += ' (' + d.slice(1, 4);
            if (d.length >= 4) out += ') ' + d.slice(4, 7);
            if (d.length >= 7) out += '-' + d.slice(7, 9);
            if (d.length >= 9) out += '-' + d.slice(9, 11);
            this.value = out;
        });
    }

    function validateIssueForm() {
        hideError('issueError');
        ['issName', 'issPhone', 'issEmail'].forEach(function (id) { $(id).classList.remove('invalid'); });

        var name = $('issName').value.trim();
        var phone = $('issPhone').value.replace(/\D/g, '');
        var email = $('issEmail').value.trim();
        var firstInvalid = null;

        if (name.length < 2) {
            $('issName').classList.add('invalid');
            showError('issueError', 'Укажите имя (минимум 2 символа).');
            firstInvalid = firstInvalid || 'issName';
        }
        if (phone.length !== 11 || phone[0] !== '7') {
            $('issPhone').classList.add('invalid');
            showError('issueError', 'Телефон должен содержать 11 цифр, например: +7 (963) 277-57-05.');
            firstInvalid = firstInvalid || 'issPhone';
        }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
            $('issEmail').classList.add('invalid');
            showError('issueError', 'Похоже, в адресе e-mail опечатка.');
            firstInvalid = firstInvalid || 'issEmail';
        }
        if (!$('agree').checked) {
            showError('issueError', 'Подтвердите согласие на обработку персональных данных.');
            var row = $('agreeRow');
            row.classList.remove('shake');
            void row.offsetWidth; // перезапуск анимации
            row.classList.add('shake');
        }

        if (firstInvalid || !$('agree').checked) {
            if (firstInvalid) $(firstInvalid).focus();
            return null;
        }

        return {
            storeId: STORE_ID,
            phoneNumber: phone,
            clientName: name,
            email: email || null,
            birthDate: $('issBirth').value || null
        };
    }

    function submitIssue() {
        var body = validateIssueForm();
        if (!body) { haptic('error'); return; }

        setLoading($('issueSubmit'), true);
        api('/api/client/card', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(function (response) { return response.json(); })
            .then(function (result) {
                if (!result.success) throw new Error(result.message || 'Не удалось выпустить карту.');
                renderMyCard(result.card);
                switchView('card');
                haptic('success');
                toast('Карта ' + result.card.cardNumber + ' готова!', 'success');
            })
            .catch(function (error) {
                haptic('error');
                showError('issueError', error.message || 'Ошибка соединения с сервером.');
            })
            .finally(function () { setLoading($('issueSubmit'), false); });
    }

    // ===================== Старая карта =====================
    // Привязка выполняется клиентским ботом (inner_ui): номер карты отправляется в чат с ботом.

    function bindOldCard() {
        hideError('oldError');
        var number = $('oldNumber').value.trim();
        if (number.length < 2) {
            $('oldNumber').classList.add('invalid');
            showError('oldError', 'Введите номер старой карты.');
            return;
        }

        copyText(number).then(function () {
            toast('Номер скопирован — в боте нажмите «Найти карту» и вставьте его', 'success');
            if (!openBotChat()) {
                showError('oldError', 'Бот пока не настроен (не задан username). Сообщите номер карты кассиру — он привяжет карту.');
            }
        }).catch(function () {
            openBotChat();
        });
    }

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text);
        }
        return Promise.reject(new Error('clipboard unavailable'));
    }

    function openBotChat() {
        var username = CFG.botUsername;
        if (!username) return false;
        var link = 'https://t.me/' + username;
        if (tg && tg.openTelegramLink) tg.openTelegramLink(link);
        else window.open(link, '_blank');
        return true;
    }

    // ===================== Экран «Магазин» =====================

    function renderStore() {
        $('storeName').textContent = CFG.storeName || 'Магазин';
        $('storeAbout').textContent = CFG.storeAbout || '';
        $('storeAddress').textContent = CFG.storeAddress || '';
        $('storePhone').textContent = CFG.storePhone || '';
        $('storeHours').textContent = CFG.storeHours || '';
        $('storeMapHref').href = CFG.storeMapLink || '#';
        $('storeOpenMap').href = CFG.storeMapLink || '#';
        $('storePhoneHref').href = 'tel:' + (CFG.storePhoneLink || '');
        $('storeMapWidget').src = CFG.storeMapEmbed || 'about:blank';
    }

    // ===================== QR-модалка =====================

    function openQrModal() {
        if (qrObjectUrl) {
            $('qrModalImg').src = qrObjectUrl;
        }
        var numberEl = $('lcNumber');
        $('qrModalNumber').textContent = numberEl ? numberEl.textContent : '';
        $('qrModal').classList.add('open');
        haptic();
    }

    // ===================== Ошибки форм =====================

    function showError(id, message) {
        var el = $(id);
        el.textContent = message;
        el.classList.remove('d-none');
    }

    function hideError(id) {
        $(id).classList.add('d-none');
    }

    // ===================== Навигация =====================

    function switchView(tab) {
        document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
        $('view-' + tab).classList.add('active');

        document.querySelectorAll('.tabbar .tab').forEach(function (t) {
            t.classList.toggle('active', t.dataset.tab === tab);
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ===================== Инициализация =====================

    document.addEventListener('DOMContentLoaded', function () {
        initTelegram();
        initPhoneMask();
        renderStore();

        // Восстановленный токен сессии ускоряет загрузку, но всегда перепроверяется на 401
        try { sessionToken = sessionStorage.getItem(TOKEN_KEY) || null; } catch (e) { /* ignore */ }

        // Подпись пользователя в шапке
        var tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
        if (tgUser && tgUser.first_name) {
            $('headerUser').textContent = tgUser.first_name + (tgUser.last_name ? ' ' + tgUser.last_name : '');
        }

        authorize()
            .then(function (authUser) {
                // Имя из Telegram — предзаполнение формы выпуска
                var name = (authUser && authUser.firstName) || (tgUser && tgUser.first_name) || '';
                if (name && !$('issName').value) $('issName').value = name;
                loadMyCard();
            })
            .catch(function () { /* гейт уже показан */ });

        // Вкладки
        document.querySelectorAll('.tabbar .tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                haptic();
                switchView(tab.dataset.tab);
            });
        });

        // Кнопки-переходы внутри экранов
        document.querySelectorAll('[data-goto]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                haptic();
                switchView(btn.dataset.goto);
            });
        });

        // Выпуск карты
        $('issueSubmit').addEventListener('click', submitIssue);

        // Обновление баланса
        $('refreshCard').addEventListener('click', function () { haptic(); refreshCard(); });

        // Старая карта
        $('oldBind').addEventListener('click', bindOldCard);
        ['oldNumber', 'issName', 'issPhone', 'issEmail'].forEach(function (id) {
            $(id).addEventListener('input', function () { this.classList.remove('invalid'); });
        });

        // QR-модалка
        $('lcQr').addEventListener('click', openQrModal);
        $('qrModalClose').addEventListener('click', function () {
            $('qrModal').classList.remove('open');
        });
        $('qrModal').addEventListener('click', function (e) {
            if (e.target === this) this.classList.remove('open');
        });

        // Гейт: кнопка «Открыть бота»
        $('gateBtn').addEventListener('click', openBotChat);
    });
})();
