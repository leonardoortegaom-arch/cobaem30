document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('alumno-actividades-filtros');
    const searchInput = document.getElementById('alumno-actividades-q');
    const stateSelect = document.getElementById('alumno-actividades-estado');
    if (!form || !searchInput || !stateSelect) return;

    const urlParameters = new URLSearchParams(window.location.search);
    const focusKey = 'cobaem30:alumno-actividades:recuperar-foco';
    let timer = null;
    let composing = false;
    const clearTimer = () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
    };
    const valuesMatchUrl = () => searchInput.value === (urlParameters.get('q') || '')
        && stateSelect.value === (urlParameters.get('estado') || '');
    const submit = (restoreFocus = false) => {
        clearTimer();
        if (valuesMatchUrl()) return;
        if (restoreFocus) {
            try { window.sessionStorage.setItem(focusKey, '1'); } catch { /* Respaldo sin almacenamiento. */ }
        }
        form.requestSubmit();
    };
    const schedule = () => {
        clearTimer();
        if (composing || valuesMatchUrl()) return;
        timer = window.setTimeout(() => submit(true), 450);
    };

    searchInput.addEventListener('compositionstart', () => { composing = true; clearTimer(); });
    searchInput.addEventListener('compositionend', () => { composing = false; schedule(); });
    searchInput.addEventListener('input', schedule);
    stateSelect.addEventListener('change', () => submit());
    form.addEventListener('submit', clearTimer);

    try {
        if (window.sessionStorage.getItem(focusKey) === '1') {
            window.sessionStorage.removeItem(focusKey);
            searchInput.focus();
            searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
        }
    } catch { /* Los filtros siguen disponibles sin sessionStorage. */ }
});
