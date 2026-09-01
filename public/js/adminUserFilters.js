document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('usuarios-filtros');
    if (!form) return;

    const searchInput = document.getElementById('usuarios-filtro-q');
    const roleSelect = document.getElementById('usuarios-filtro-rol');
    const statusSelect = document.getElementById('usuarios-filtro-estado');
    if (!searchInput || !roleSelect || !statusSelect) return;

    const focusStorageKey = 'cobaem30:usuarios-filtros:recuperar-foco';
    const urlParameters = new URLSearchParams(window.location.search);
    let debounceTimer = null;
    let isComposing = false;

    const clearPendingSubmit = () => {
        if (debounceTimer !== null) {
            window.clearTimeout(debounceTimer);
            debounceTimer = null;
        }
    };

    const valuesMatchUrl = () => searchInput.value === (urlParameters.get('q') || '')
        && roleSelect.value === (urlParameters.get('rol') || '')
        && statusSelect.value === (urlParameters.get('estado') || '');

    const rememberSearchFocus = () => {
        try {
            window.sessionStorage.setItem(focusStorageKey, '1');
        } catch {
            // El formulario sigue funcionando aunque sessionStorage no esté disponible.
        }
    };

    const submitAutomatically = ({ restoreSearchFocus = false } = {}) => {
        clearPendingSubmit();
        if (valuesMatchUrl()) return;

        if (restoreSearchFocus) {
            rememberSearchFocus();
        }

        form.requestSubmit();
    };

    const scheduleSearchSubmit = () => {
        clearPendingSubmit();
        if (isComposing || valuesMatchUrl()) return;

        debounceTimer = window.setTimeout(() => {
            debounceTimer = null;
            submitAutomatically({ restoreSearchFocus: true });
        }, 450);
    };

    searchInput.addEventListener('compositionstart', () => {
        isComposing = true;
        clearPendingSubmit();
    });

    searchInput.addEventListener('compositionend', () => {
        isComposing = false;
        scheduleSearchSubmit();
    });

    searchInput.addEventListener('input', scheduleSearchSubmit);
    roleSelect.addEventListener('change', () => submitAutomatically());
    statusSelect.addEventListener('change', () => submitAutomatically());
    form.addEventListener('submit', clearPendingSubmit);

    try {
        if (window.sessionStorage.getItem(focusStorageKey) === '1') {
            window.sessionStorage.removeItem(focusStorageKey);
            searchInput.focus();
            const cursorPosition = searchInput.value.length;
            searchInput.setSelectionRange(cursorPosition, cursorPosition);
        }
    } catch {
        // No se requiere almacenamiento para usar los filtros.
    }
});
