document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('reportes-filtros');
    if (!form) return;
    const searchInput = document.getElementById('reportes-filtro-q');
    const selects = [document.getElementById('reportes-filtro-grupo'), document.getElementById('reportes-filtro-estado')];
    if (!searchInput || selects.some((select) => !select)) return;
    const urlParameters = new URLSearchParams(window.location.search);
    const focusKey = 'cobaem30:reportes:recuperar-foco';
    let timer = null;
    let composing = false;
    const clearTimer = () => { if (timer !== null) { window.clearTimeout(timer); timer = null; } };
    const sameValues = () => searchInput.value === (urlParameters.get('q') || '') && selects.every((select) => select.value === (urlParameters.get(select.name) || ''));
    const submit = (restoreFocus = false) => { clearTimer(); if (sameValues()) return; if (restoreFocus) { try { window.sessionStorage.setItem(focusKey, '1'); } catch {} } form.requestSubmit(); };
    const schedule = () => { clearTimer(); if (composing || sameValues()) return; timer = window.setTimeout(() => { timer = null; submit(true); }, 450); };
    searchInput.addEventListener('compositionstart', () => { composing = true; clearTimer(); });
    searchInput.addEventListener('compositionend', () => { composing = false; schedule(); });
    searchInput.addEventListener('input', schedule);
    selects.forEach((select) => select.addEventListener('change', () => submit()));
    form.addEventListener('submit', clearTimer);
    try { if (window.sessionStorage.getItem(focusKey) === '1') { window.sessionStorage.removeItem(focusKey); searchInput.focus(); searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length); } } catch {}
});
