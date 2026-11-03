// Persona Quick List (slim edition)
// - Persona switcher button next to the chat input + popup list
// - Connection profile (API / model) switcher, adapted from Extension-TopInfoBar (AGPLv3)

import { animation_duration, eventSource, event_types, getThumbnailUrl } from '../../../../script.js';
import { power_user } from '../../../power-user.js';
import { getUserAvatar, getUserAvatars, setUserAvatar, user_avatar } from '../../../personas.js';
import { debounce, waitUntilCondition } from '../../../utils.js';
import { Popper } from '../../../../lib.js';

const MODULE_NAME = 'Persona-Quick-List';
const MENU_TITLE = '페르소나 · 모델 전환'; // 팝업 맨 위에 보이는 이름 (원하는 이름으로 바꾸세요)
const supportsPersonaThumbnails = getThumbnailUrl('persona', 'test.png', true).includes('&t=');

/** @type {Popper.Instance|null} */
let popper = null;
let isOpen = false;
let _isOpening = false;
let _updateButtonTimer = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getImageUrl(avatarId) {
    if (supportsPersonaThumbnails) return getThumbnailUrl('persona', avatarId, true);
    return getUserAvatar(avatarId);
}

function getPersonaName(avatarId) {
    return power_user.personas?.[avatarId] || avatarId;
}

// Sort: special characters first, then Korean, then English
function getNameCategory(name) {
    const ch = (name || '')[0] || '';
    if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(ch)) return 1;
    if (/[a-zA-Z]/.test(ch)) return 2;
    return 0;
}

function sortAvatars(avatarIds) {
    return [...avatarIds].sort((a, b) => {
        const na = getPersonaName(a);
        const nb = getPersonaName(b);
        const ca = getNameCategory(na);
        const cb = getNameCategory(nb);
        if (ca !== cb) return ca - cb;
        return na.localeCompare(nb, 'ko');
    });
}

// ─── Button next to the chat input ────────────────────────────────────────────
function addQuickPersonaButton() {
    if ($('#qplBtn').length) return;
    const $c = $('#leftSendForm').length ? $('#leftSendForm')
        : $('#send_form').length ? $('#send_form')
        : $('form#send_form, .sendForm, #form_sheld').first();
    if (!$c.length) { setTimeout(addQuickPersonaButton, 1000); return; }
    $c.append(`
        <div id="qplBtn" tabindex="0" title="페르소나 · 모델 전환">
            <img id="qplBtnImg" src="/img/ai4.png" alt="persona" />
        </div>
    `);
    $('#qplBtn').on('click', () => toggleMenu());
    $('#qplBtn').on('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMenu(); }
    });
}

function updateButtonState() {
    clearTimeout(_updateButtonTimer);
    _updateButtonTimer = setTimeout(() => {
        const name  = getPersonaName(user_avatar);
        const title = power_user.persona_descriptions?.[user_avatar]?.title || '';
        $('#qplBtnImg')
            .attr('src', getImageUrl(user_avatar))
            .attr('title', title ? `${name} — ${title}` : name);
    }, 100);
}

// ─── Popup ────────────────────────────────────────────────────────────────────
async function toggleMenu() {
    if (isOpen) closeMenu(); else await openMenu();
}

async function openMenu() {
    if (_isOpening) return;
    _isOpening = true;
    isOpen = true;

    $('#qplMenu').stop(true, true).remove();
    if (popper) { popper.destroy(); popper = null; }

    try {
        const avatars = sortAvatars(await getUserAvatars(false));

        const $menu = $(`
            <div id="qplMenu">
                <div class="qpl-header">
                    <span class="qpl-header-title"></span>
                </div>
                <div class="qpl-profile-bar">
                    <i class="fa-fw fa-solid fa-network-wired"></i>
                    <select class="qpl-profile-select" title="연결 프로필 전환"></select>
                </div>
                <div class="qpl-profile-status"></div>
                <div class="qpl-search-wrap">
                    <input type="search" class="qpl-search text_pole" placeholder="페르소나 검색" autocomplete="off" />
                </div>
                <div class="qpl-list"></div>
            </div>
        `);

        $menu.find('.qpl-header-title').text(MENU_TITLE);

        const $list = $menu.find('.qpl-list');
        avatars.forEach(id => $list.append(createRow(id)));
        $list.append('<div class="qpl-empty" style="display:none">검색 결과가 없어요.</div>');

        $menu.find('.qpl-search').on('input', function () {
            filterRows(String($(this).val() || ''));
        });

        $menu.find('.qpl-profile-select').on('change', function () {
            const main = /** @type {HTMLSelectElement|null} */ (document.getElementById('connection_profiles'));
            if (!main) return;
            const label = String($(this).find('option:selected').text()).trim();
            expectProfileChange(label); // register before dispatching so a fast "loaded" event is not missed
            main.value = this.value;
            main.dispatchEvent(new Event('change'));
        });

        $menu.css({ visibility: 'hidden', display: 'block' });
        $(document.body).append($menu);

        syncProfileSelect();
        updateProfileStatus();

        popper = Popper.createPopper(
            document.getElementById('qplBtn'),
            document.getElementById('qplMenu'),
            {
                placement: 'top-start',
                modifiers: [
                    { name: 'offset', options: { offset: [0, 6] } },
                    // altAxis keeps the popup on screen vertically (e.g. when the keyboard opens)
                    { name: 'preventOverflow', options: { padding: 8, altAxis: true } },
                    // No flipping: a flip would swap the horizontal side and make the popup jump sideways
                    { name: 'flip', enabled: false },
                ],
            },
        );
        await popper.update();

        $menu.css({ visibility: '', display: 'none' }).fadeIn(animation_duration);

        // Keep the popup anchored when the on-screen keyboard resizes the viewport
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', _onViewportResize);
        }
    } finally {
        _isOpening = false;
    }
}

function _onViewportResize() {
    if (popper) requestAnimationFrame(() => popper.update());
}

function closeMenu() {
    if (!isOpen) return;
    isOpen = false;

    if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', _onViewportResize);
    }

    // Destroy popper only after the fade-out: destroying it first resets the
    // popup's position and makes it jump while it is still visible.
    const $menu = $('#qplMenu');
    const closingPopper = popper;
    popper = null;
    $menu.stop(true).fadeOut(animation_duration, () => {
        $menu.remove();
        if (closingPopper) closingPopper.destroy();
    });
}

// ─── Persona row ──────────────────────────────────────────────────────────────
function createRow(avatarId) {
    const name      = getPersonaName(avatarId);
    const title     = power_user.persona_descriptions?.[avatarId]?.title || '';
    const isActive  = avatarId === user_avatar;
    const isDefault = avatarId === power_user.default_persona;

    const $row = $('<div class="qpl-row"></div>')
        .attr('data-avatar', avatarId)
        .attr('data-search', `${name} ${title}`.toLowerCase())
        .toggleClass('qpl-active', isActive);

    const $img = $('<img class="qpl-avatar" />')
        .attr('src', getImageUrl(avatarId))
        .attr('alt', name)
        .toggleClass('qpl-default', isDefault);

    const $info = $('<div class="qpl-info"></div>');
    $info.append($('<span class="qpl-name"></span>').text(name));
    if (title) $info.append($('<span class="qpl-tag"></span>').text(title));

    $row.append($('<div class="qpl-avatar-wrap"></div>').append($img), $info);

    // One tap → apply persona
    $row.on('click', () => applyPersona(avatarId));

    return $row;
}

function filterRows(query) {
    const q = query.trim().toLowerCase();
    let visible = 0;
    $('#qplMenu .qpl-row').each(function () {
        const match = !q || String($(this).attr('data-search')).includes(q);
        $(this).toggle(match);
        if (match) visible++;
    });
    $('#qplMenu .qpl-empty').toggle(visible === 0);
}

async function applyPersona(avatarId) {
    try {
        await setUserAvatar(avatarId);
        updateButtonState();
        closeMenu();
    } catch (err) {
        console.error(`[${MODULE_NAME}] 페르소나 적용 실패:`, err);
        toastr.error('페르소나 적용에 실패했습니다.');
    }
}

// ─── Connection profile (model) switcher — adapted from Extension-TopInfoBar ──
function syncProfileSelect() {
    const $select = $('#qplMenu .qpl-profile-select');
    if (!$select.length) return;
    const main = /** @type {HTMLSelectElement|null} */ (document.getElementById('connection_profiles'));
    if (!main) {
        // Connection Profiles extension is disabled or not loaded yet
        $select.hide();
        return;
    }
    $select.show();
    $select.html(main.innerHTML);
    $select.val(main.value);
}

/**
 * Reads the current "API – model" text.
 * @returns {Promise<string|null>} null when there is no connection
 */
async function getProfileStatusText() {
    const { SlashCommandParser, onlineStatus, mainApi } = SillyTavern.getContext();
    if (onlineStatus === 'no_connection') return null;

    const apiBlock = document.getElementById('rm_api_block');

    async function getCurrentAPI() {
        let currentAPI = mainApi;
        try {
            const result = await SlashCommandParser.commands['api'].callback({ quiet: 'true' }, '');
            if (result) currentAPI = result;
        } catch (error) {
            console.error(`[${MODULE_NAME}] 현재 API 확인 실패`, error);
        }
        const opt = apiBlock?.querySelector(`select:not(#main_api) option[value="${currentAPI}"]`)
            ?? apiBlock?.querySelector(`select#main_api option[value="${currentAPI}"]`);
        // Remove text in parentheses or brackets
        return opt ? opt.textContent.replace(/[[(].*[\])]/, '').trim() : currentAPI;
    }

    async function getCurrentModel() {
        let currentModel = onlineStatus;
        try {
            const result = await SlashCommandParser.commands['model'].callback({ quiet: 'true' }, '');
            if (result && typeof result === 'string') currentModel = result;
        } catch (error) {
            console.error(`[${MODULE_NAME}] 현재 모델 확인 실패`, error);
        }
        const opt = apiBlock?.querySelector(`option[value="${currentModel}"]`);
        return opt ? opt.textContent.trim() : currentModel;
    }

    const [api, model] = await Promise.all([getCurrentAPI(), getCurrentModel()]);
    return `${api} – ${model}`;
}

async function updateProfileStatus() {
    if (!$('#qplMenu .qpl-profile-status').length) return;

    if (!document.getElementById('connection_profiles')) {
        $('#qplMenu .qpl-profile-status').removeClass('offline')
            .text('연결 프로필을 쓰려면 Connection Profiles 확장을 켜주세요.');
        return;
    }

    const text = await getProfileStatusText();
    // The popup may have been closed while we were waiting
    const $status = $('#qplMenu .qpl-profile-status');
    if (text === null) $status.addClass('offline').text('연결 안 됨...');
    else $status.removeClass('offline').text(text);
}

// Notify as soon as the profile is applied (same feel as the persona toast)
let _pendingProfile = null;
let _pendingTimer = null;

function expectProfileChange(label) {
    _pendingProfile = label;
    clearTimeout(_pendingTimer);
    // Fallback in case the "profile loaded" event never arrives
    _pendingTimer = setTimeout(notifyProfileChanged, 1200);
}

async function notifyProfileChanged() {
    if (_pendingProfile === null) return;
    const label = _pendingProfile;
    _pendingProfile = null;
    clearTimeout(_pendingTimer);

    const text = await getProfileStatusText();
    updateProfileStatus();
    if (text === null) toastr.warning(`${label} (연결 안 됨)`, 'Model Changed');
    else toastr.success(`${label}: ${text}`, 'Model Changed');
}

function bindConnectionProfiles() {
    if (event_types.CONNECTION_PROFILE_LOADED) {
        eventSource.on(event_types.CONNECTION_PROFILE_LOADED, notifyProfileChanged);
    }

    const updateStatusDebounced = debounce(updateProfileStatus, 1000);

    document.getElementById('rm_api_block')?.querySelectorAll('select').forEach(select => {
        select.addEventListener('input', () => updateStatusDebounced());
    });
    eventSource.on(event_types.ONLINE_STATUS_CHANGED, updateStatusDebounced);

    waitUntilCondition(() => document.getElementById('connection_profiles') !== null, 10000, 200)
        .then(() => {
            const main = /** @type {HTMLSelectElement} */ (document.getElementById('connection_profiles'));
            main.addEventListener('change', () => {
                if (isOpen) { syncProfileSelect(); updateStatusDebounced(); }
            });
            new MutationObserver(() => { if (isOpen) syncProfileSelect(); })
                .observe(main, { childList: true });
        })
        .catch(() => { /* Connection Profiles is not installed; the popup shows a hint instead */ });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
jQuery(async () => {
    try {
        eventSource.on(event_types.CHAT_CHANGED, updateButtonState);
        eventSource.on(event_types.SETTINGS_UPDATED, updateButtonState);
        eventSource.on(event_types.APP_READY, () => {
            addQuickPersonaButton();
            updateButtonState();
            bindConnectionProfiles();
        });
        addQuickPersonaButton();

        $(document.body).on('click.qpl', e => {
            if (isOpen && !e.target.closest('#qplMenu') && !e.target.closest('#qplBtn')) closeMenu();
        });
        updateButtonState();
        console.log(`[${MODULE_NAME}] ✅ 로드 완료`);
    } catch (err) {
        console.error(`[${MODULE_NAME}] ❌ 초기화 오류:`, err);
    }
});
