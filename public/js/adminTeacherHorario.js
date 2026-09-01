document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('[data-csrf-upload]');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const response = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { 'x-csrf-token': form.dataset.csrfUpload } });
            const html = await response.text();
            if (response.redirected) return window.location.assign(response.url);
            document.open(); document.write(html); document.close();
        } catch { button.disabled = false; window.alert('No fue posible importar el horario.'); }
    });
});