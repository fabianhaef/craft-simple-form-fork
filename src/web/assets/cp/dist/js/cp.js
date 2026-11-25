/*
 * Simple Form — Control Panel behaviors.
 *
 * Consolidated from the per-template inline <script> blocks (#100). Each block
 * is guarded on the presence of its root element, so this single file is safe
 * to load on every CP screen. Dynamic values (action URLs, translated
 * messages) are read from data-* attributes set by the templates.
 *
 * Craft 6 marks these legacy Twig-rendered screens "Bridged" and loads their
 * real content into the shell *after* this script already ran — and on at
 * least one screen (`sf-integration-type`), replaces that content's DOM
 * nodes again shortly after the first paint, discarding anything bound
 * directly to them. So nothing here binds to a specific node up front:
 * actions (click/change/submit) are wired once via delegation on `document`,
 * reading data-* attributes fresh off the matched element at event time;
 * one-time-per-node setup (initial visibility sync, Craft.ElevatedSessionForm
 * instances) uses `onEachAppearance()`, which re-runs for a replacement node
 * exactly like it would for a first-seen one.
 */
(function () {
    'use strict';

    var csrf = window.Craft && Craft.csrfTokenValue;

    /**
     * Runs `callback(el)` once for every element currently matching
     * `selector`, and again for every later-appearing one — including a
     * node that replaces an earlier match with the same id/selector. Each
     * node is only ever passed to `callback` once.
     *
     * @param {string} selector
     * @param {function(Element): void} callback
     */
    function onEachAppearance(selector, callback) {
        var seen = new WeakSet();
        function scan() {
            document.querySelectorAll(selector).forEach(function (el) {
                if (seen.has(el)) { return; }
                seen.add(el);
                callback(el);
            });
        }
        scan();
        new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    }

    /**
     * POST form-encoded body, expecting a JSON `{success, error}` response.
     * Mirrors the controllers' requireAcceptsJson() contract.
     */
    function postJson(url, body, onSuccess, messages) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        xhr.setRequestHeader('X-CSRF-Token', csrf);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.onload = function () {
            var r = null;
            try { r = JSON.parse(xhr.responseText); } catch (e) { r = null; }
            if (xhr.status === 200 && r && r.success) {
                onSuccess(r);
            } else {
                Craft.cp.displayError((r && r.error) || messages.generic);
            }
        };
        xhr.onerror = function () {
            Craft.cp.displayError(messages.network || messages.generic);
        };
        xhr.send(body);
    }

    function t(message) {
        return (window.Craft && Craft.t) ? Craft.t('app', message) : message;
    }

    /**
     * Promise-based confirmation rendered as a Craft-styled <dialog> — replaces
     * the native confirm() so destructive CP actions get a consistent,
     * accessible (focus-trapped, Esc-dismissable) prompt. Resolves true when
     * confirmed, false on cancel/dismiss.
     */
    function sfConfirm(message) {
        return new Promise(function (resolve) {
            var dialog = document.createElement('dialog');
            dialog.className = 'sf-confirm';

            var msg = document.createElement('p');
            msg.className = 'sf-confirm-msg';
            msg.textContent = message;

            var actions = document.createElement('div');
            actions.className = 'sf-confirm-actions';

            var cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'btn';
            cancel.textContent = t('Cancel');

            var ok = document.createElement('button');
            ok.type = 'button';
            ok.className = 'btn submit';
            ok.textContent = t('OK');

            actions.appendChild(cancel);
            actions.appendChild(ok);
            dialog.appendChild(msg);
            dialog.appendChild(actions);
            document.body.appendChild(dialog);

            function done(result) {
                if (dialog.open) { dialog.close(); }
                dialog.remove();
                resolve(result);
            }
            cancel.addEventListener('click', function () { done(false); });
            ok.addEventListener('click', function () { done(true); });
            // Esc / backdrop dismissal counts as cancel.
            dialog.addEventListener('cancel', function (e) { e.preventDefault(); done(false); });

            dialog.showModal();
            ok.focus();
        });
    }

    // Shared with form-builder.js (same asset bundle, loaded first) so the
    // builder's destructive actions use the same accessible dialog (#288).
    window.SimpleFormCp = window.SimpleFormCp || {};
    window.SimpleFormCp.sfConfirm = sfConfirm;

    /**
     * Form editor tabs: honour an incoming `#pane` hash (e.g. arriving from the
     * Notifications/Integrations screens, whose tab strip deep-links back here)
     * by activating that tab. Craft.CP wires the in-page panes but selects the
     * server-rendered default tab on load, so deep-links need a nudge. Inert
     * when there's no `#pane` hash.
     */
    function activateHashTab(tabs, attempt) {
        var hash = window.location.hash;
        var tab = tabs.querySelector('a[role="tab"][href="' + hash + '"]');
        if (!tab || tab.classList.contains('sel')) {
            return;
        }
        var cp = window.Craft && Craft.cp;
        if (cp && cp.tabManager) {
            cp.tabManager.selectTab(tab);
            return;
        }
        // The tab manager isn't wired yet on first paint; retry briefly, then
        // fall back to a native click (which Craft.Tabs also listens for).
        if ((attempt || 0) < 20) {
            setTimeout(function () { activateHashTab(tabs, (attempt || 0) + 1); }, 50);
        } else {
            tab.click();
        }
    }
    (function () {
        var hash = window.location.hash;
        if (!hash || hash.charAt(0) !== '#') {
            return;
        }
        onEachAppearance('#tabs', function (tabs) { activateHashTab(tabs, 0); });
    })();

    // Any form opting into confirmation defers submit until the user agrees.
    document.addEventListener('submit', function (e) {
        var form = e.target;
        if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-sf-confirm') || form.__sfConfirmArmed) {
            return;
        }
        e.preventDefault();
        sfConfirm(form.dataset.sfConfirm).then(function (ok) {
            if (ok) { form.__sfConfirmArmed = true; form.submit(); }
        });
    });

    // --- Submission detail: toggle read status ---
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('#toggle-status-btn');
        if (!btn) { return; }
        var msg = { generic: btn.dataset.error, network: btn.dataset.error };
        postJson(
            btn.dataset.action,
            'submissionId=' + btn.dataset.submissionId,
            function () { location.reload(); },
            msg,
        );
    });

    /**
     * Shared by the Integrations/Notifications/Coupons index screens: a
     * container with `data-toggle-url`/`data-delete-url`/`data-error`/
     * `data-network-error`, each row's status toggled via `.status-toggle`
     * and removed via `.delete[data-id]`.
     *
     * @param {string} containerId
     * @param {string} idParam The POSTed id field name (e.g. `integrationId`).
     */
    function wireIndexToggleDelete(containerId, idParam) {
        document.addEventListener('click', function (e) {
            var container = e.target.closest('#' + containerId);
            if (!container) { return; }
            var msgs = { generic: container.dataset.error, network: container.dataset.networkError };

            var toggleBtn = e.target.closest('.status-toggle');
            if (toggleBtn && container.contains(toggleBtn)) {
                postJson(container.dataset.toggleUrl, idParam + '=' + toggleBtn.dataset.id,
                    function () { location.reload(); }, msgs);
                return;
            }

            var deleteBtn = e.target.closest('.delete[data-id]');
            if (deleteBtn && container.contains(deleteBtn)) {
                sfConfirm(container.dataset.confirmDelete).then(function (ok) {
                    if (!ok) { return; }
                    postJson(container.dataset.deleteUrl, idParam + '=' + deleteBtn.dataset.id,
                        function () { location.reload(); }, msgs);
                });
            }
        });
    }
    wireIndexToggleDelete('sf-integrations', 'integrationId');
    wireIndexToggleDelete('sf-notifications', 'notificationId');
    wireIndexToggleDelete('sf-coupons', 'couponId');

    // --- Per-form integrations: attach/detach a global integration to a form ---
    document.addEventListener('click', function (e) {
        var container = e.target.closest('#sf-form-integrations');
        var btn = e.target.closest('.attach-toggle');
        if (!container || !btn || !container.contains(btn)) { return; }
        var msgs = { generic: container.dataset.error, network: container.dataset.networkError };
        postJson(container.dataset.toggleUrl,
            'formId=' + container.dataset.formId + '&integrationId=' + btn.dataset.id,
            function () { location.reload(); }, msgs);
    });

    // --- Integration editor: pick a type from the dropdown, load its fields ---
    document.addEventListener('change', function (e) {
        var el = e.target.closest('#sf-integration-type');
        if (!el || !el.dataset.newUrl || !el.value) { return; }
        // cpUrl() already carries a ?site= query, so merge the param rather
        // than blindly appending a second '?'.
        var url = new URL(el.dataset.newUrl, window.location.origin);
        url.searchParams.set('type', el.value);
        window.location = url.toString();
    });

    // --- Settings → Spam: conditional visibility of provider/type blocks ---
    // Craft's checkboxField renders a hidden input *and* the checkbox under the
    // same name; target the checkbox specifically.
    function syncCaptchaSettingsVisibility(checkbox) {
        var settings = document.getElementById('captcha-settings');
        if (settings) { settings.style.display = checkbox.checked ? 'block' : 'none'; }
    }
    onEachAppearance('input[type="checkbox"][name="enableCaptcha"]', syncCaptchaSettingsVisibility);
    document.addEventListener('change', function (e) {
        var el = e.target.closest('input[type="checkbox"][name="enableCaptcha"]');
        if (el) { syncCaptchaSettingsVisibility(el); }
    });

    function showCaptchaType(type) {
        document.querySelectorAll('.captcha-type-settings').forEach(function (el) {
            el.style.display = 'none';
        });
        var typeEl = document.getElementById(type + '-settings');
        if (typeEl) { typeEl.style.display = 'block'; }
    }
    onEachAppearance('#captchaType', function (captchaType) { showCaptchaType(captchaType.value); });
    document.addEventListener('change', function (e) {
        var el = e.target.closest('#captchaType');
        if (el) { showCaptchaType(el.value); }
    });

    function showProvider(handle) {
        document.querySelectorAll('.captcha-provider-settings').forEach(function (el) {
            el.style.display = 'none';
        });
        var el = document.getElementById(handle + '-provider-settings');
        if (el) { el.style.display = 'block'; }
    }
    onEachAppearance('#selectedCaptchaProvider', function (providerSelect) { showProvider(providerSelect.value); });
    document.addEventListener('change', function (e) {
        var el = e.target.closest('#selectedCaptchaProvider');
        if (el) { showProvider(el.value); }
    });

    function syncAkismetSettingsVisibility(checkbox) {
        var settings = document.getElementById('akismet-settings');
        if (settings) { settings.style.display = checkbox.checked ? 'block' : 'none'; }
    }
    onEachAppearance('input[type="checkbox"][name="enableAkismet"]', syncAkismetSettingsVisibility);
    document.addEventListener('change', function (e) {
        var el = e.target.closest('input[type="checkbox"][name="enableAkismet"]');
        if (el) { syncAkismetSettingsVisibility(el); }
    });

    // --- Forms index: open the import-a-form modal (#139) ---
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('#sf-import-btn');
        if (!btn || !window.Garnish) { return; }
        var importModalEl = document.getElementById('sf-import-modal');
        if (!importModalEl) { return; }
        if (!importModalEl.__sfModal) {
            importModalEl.__sfModal = new Garnish.Modal($(importModalEl), { autoShow: false });
            importModalEl.querySelectorAll('[data-sf-import-cancel]').forEach(function (cancelBtn) {
                cancelBtn.addEventListener('click', function () { importModalEl.__sfModal.hide(); });
            });
        }
        importModalEl.__sfModal.show();
    });

    // #140: reveal the denylist textareas only when denylists are enabled.
    function syncDenylistSettingsVisibility(checkbox) {
        var settings = document.getElementById('denylist-settings');
        if (settings) { settings.style.display = checkbox.checked ? 'block' : 'none'; }
    }
    onEachAppearance('input[type="checkbox"][name="enableDenylists"]', syncDenylistSettingsVisibility);
    document.addEventListener('change', function (e) {
        var el = e.target.closest('input[type="checkbox"][name="enableDenylists"]');
        if (el) { syncDenylistSettingsVisibility(el); }
    });

    // --- Notification editor: Recipient type toggles fixed-address vs. field ---
    // The fixed input and the field-select both post as `recipient`; only the
    // active one may be enabled so a single value is submitted.
    function syncRecipientInputs(recipientType) {
        var recipientFixed = document.getElementById('sf-recipient-fixed');
        var recipientField = document.getElementById('sf-recipient-field');
        if (!recipientFixed || !recipientField) { return; }
        var isField = recipientType.value === 'field';
        recipientFixed.classList.toggle('hidden', isField);
        recipientField.classList.toggle('hidden', !isField);
        recipientFixed.querySelectorAll('input, select').forEach(function (el) {
            el.disabled = isField;
        });
        recipientField.querySelectorAll('input, select').forEach(function (el) {
            el.disabled = !isField;
        });
    }
    onEachAppearance('#recipientType', syncRecipientInputs);
    document.addEventListener('change', function (e) {
        var el = e.target.closest('#recipientType');
        if (el) { syncRecipientInputs(el); }
    });

    // Elevated-session guard for sensitive settings forms: minting an MCP token
    // and saving the Spam Protection secrets require a re-verified password
    // (server-enforced in SettingsController). Craft.ElevatedSessionForm
    // intercepts the submit and shows the password modal, so the full-page POST
    // isn't rejected with a 403. Any form flagged `data-sf-elevated` is wired;
    // the shared settings full-page form is flagged indirectly via a marker
    // (it renders `#main-form`, which the tab include can't annotate directly).
    if (window.Craft && Craft.ElevatedSessionForm) {
        onEachAppearance('form[data-sf-elevated]', function (form) {
            new Craft.ElevatedSessionForm(form);
        });
        onEachAppearance('#main-form', function (mainForm) {
            if (document.querySelector('[data-sf-elevate-main-form]')) {
                new Craft.ElevatedSessionForm(mainForm);
            }
        });
    }
})();
