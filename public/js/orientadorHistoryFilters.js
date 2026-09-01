document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('historial-filtros');
    if (!form) return;

    const searchInput = document.getElementById('historial-filtro-q');
    const immediateFields = [
        document.getElementById('historial-filtro-tipo'),
        document.getElementById('historial-filtro-desde'),
        document.getElementById('historial-filtro-hasta')
    ];
    if (!searchInput || immediateFields.some((field) => !field)) return;

    const focusStorageKey = 'cobaem30:historial-filtros:recuperar-foco';
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
        && immediateFields.every((field) => {
            const urlValue = urlParameters.get(field.name)
                || (field.name === 'tipo' ? 'TODOS' : '');
            return field.value === urlValue;
        });

    const submitAutomatically = ({ restoreSearchFocus = false } = {}) => {
        clearPendingSubmit();
        if (valuesMatchUrl()) return;

        if (restoreSearchFocus) {
            try {
                window.sessionStorage.setItem(focusStorageKey, '1');
            } catch {
                // El formulario funciona sin almacenamiento de sesión.
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
        // La recuperación del foco es opcional.
    }
});
