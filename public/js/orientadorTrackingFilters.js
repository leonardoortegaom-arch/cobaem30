document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('seguimientos-filtros');
    if (!form) return;

    const searchInput = document.getElementById('seguimientos-filtro-q');
    const immediateFields = [
        document.getElementById('seguimientos-filtro-tipo'),
        document.getElementById('seguimientos-filtro-desde'),
        document.getElementById('seguimientos-filtro-hasta')
    ];
    if (!searchInput || immediateFields.some((field) => !field)) return;

    const focusStorageKey = 'cobaem30:seguimientos-filtros:recuperar-foco';
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
        && immediateFields.every((field) => field.value === (urlParameters.get(field.name) || ''));

    const submitAutomatically = ({ restoreSearchFocus = false } = {}) => {
        clearPendingSubmit();
        if (valuesMatchUrl()) return;

        if (restoreSearchFocus) {
            try {
                window.sessionStorage.setItem(focusStorageKey, '1');
            } catch {
                // El formulario funciona aunque sessionStorage no esté disponible.
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
    immediateFields.forEach((field) => {
        field.addEventListener('change', () => submitAutomatically());
    });
    form.addEventListener('submit', clearPendingSubmit);

    try {
        if (window.sessionStorage.getItem(focusStorageKey) === '1') {
            window.sessionStorage.removeItem(focusStorageKey);
            searchInput.focus();
            searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
        }
    } catch {
        // No se requiere almacenamiento para usar los filtros.
    }
});
