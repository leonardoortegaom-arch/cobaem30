document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('orientador-alumnos-filtros');
    if (!form) return;

    const searchInput = document.getElementById('orientador-alumnos-q');
    const groupSelect = document.getElementById('orientador-alumnos-grupo');
    const statusSelect = document.getElementById('orientador-alumnos-estado');
    if (!searchInput || !groupSelect || !statusSelect) return;

    const selects = [groupSelect, statusSelect];
    const focusStorageKey = 'cobaem30:orientador-alumnos:recuperar-foco';
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
        && selects.every((select) => select.value === (urlParameters.get(select.name) || ''));

    const submitAutomatically = ({ restoreSearchFocus = false } = {}) => {
        clearPendingSubmit();
        if (valuesMatchUrl()) return;

        if (restoreSearchFocus) {
            try {
                window.sessionStorage.setItem(focusStorageKey, '1');
            } catch {
                // El formulario conserva su funcionamiento sin sessionStorage.
            }
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
    selects.forEach((select) => {
        select.addEventListener('change', () => submitAutomatically());
    });
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
