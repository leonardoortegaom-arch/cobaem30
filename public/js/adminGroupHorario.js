document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('grupo-horario-upload-form');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;

        try {
            const response = await fetch(form.action, {
                method: 'POST',
                body: new FormData(form),
                headers: { 'x-csrf-token': form.dataset.csrfToken }
            });
            const html = await response.text();
            if (response.redirected) {
                window.location.assign(response.url);
                return;
            }
            document.open();
            document.write(html);
            document.close();
        } catch {
            button.disabled = false;
            window.alert('No fue posible importar el horario.');
        }
    });
});