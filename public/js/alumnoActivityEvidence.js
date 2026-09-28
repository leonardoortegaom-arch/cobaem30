document.addEventListener('DOMContentLoaded', () => {
    const uploader = document.getElementById('student-activity-evidence-uploader');
    const deleteForms = document.querySelectorAll('.student-activity-evidence-delete-form');
    deleteForms.forEach((form) => {
        form.addEventListener('submit', (event) => {
            if (!window.confirm('Esta evidencia se eliminará permanentemente.')) event.preventDefault();
        });
    });
    if (!uploader) return;

    const dropzone = document.getElementById('student-activity-evidence-dropzone');
    const input = document.getElementById('student-activity-evidence-input');
    const selection = document.getElementById('student-activity-evidence-selection');
    const submit = document.getElementById('student-activity-evidence-submit');
    const message = document.getElementById('student-activity-evidence-message');
    const progress = document.getElementById('student-activity-evidence-progress');
    const progressBar = progress.firstElementChild;
    const maxFileBytes = 50 * 1024 * 1024;
    const maxTotalBytes = 100 * 1024 * 1024;
    const currentCount = Number(uploader.dataset.currentCount);
    const currentBytes = Number(uploader.dataset.currentBytes);
    let selectedFiles = [];
    let uploading = false;

    const formatSize = (bytes) => bytes < 1048576
        ? `${Math.max(1, Math.round(bytes / 1024))} KB`
        : `${(bytes / 1048576).toFixed(1)} MB`;
    const setMessage = (text, isError = false) => {
        message.textContent = text;
        message.classList.toggle('is-error', isError);
    };
    const validateSelection = (files) => {
        if (files.length === 0) return 'Selecciona al menos un archivo.';
        if (currentCount + files.length > 5) return 'La actividad admite como máximo 5 archivos.';
        if (files.some((file) => file.size > maxFileBytes)) return 'Cada archivo debe pesar como máximo 50 MB.';
        const batchBytes = files.reduce((total, file) => total + file.size, 0);
        if (currentBytes + batchBytes > maxTotalBytes) return 'El total de evidencias no puede superar 100 MB.';
        return '';
    };
    const renderSelection = () => {
        selection.replaceChildren();
        selectedFiles.forEach((file, index) => {
            const item = document.createElement('li');
            const details = document.createElement('span');
            const name = document.createElement('strong');
            const size = document.createElement('small');
            const remove = document.createElement('button');
            name.textContent = file.name;
            size.textContent = formatSize(file.size);
            details.append(name, size);
            remove.type = 'button';
            remove.textContent = 'Retirar';
            remove.addEventListener('click', () => {
                if (uploading) return;
                selectedFiles.splice(index, 1);
                renderSelection();
            });
            item.append(details, remove);
            selection.append(item);
        });
        const error = validateSelection(selectedFiles);
        submit.disabled = Boolean(error) || uploading;
        setMessage(selectedFiles.length ? error : '', Boolean(error));
    };
    const setFiles = (files) => {
        if (uploading) return;
        selectedFiles = Array.from(files);
        renderSelection();
    };

    input.addEventListener('change', () => setFiles(input.files));
    dropzone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); }
    });
    ['dragenter', 'dragover'].forEach((name) => dropzone.addEventListener(name, (event) => {
        event.preventDefault();
        dropzone.classList.add('is-dragging');
    }));
    ['dragleave', 'drop'].forEach((name) => dropzone.addEventListener(name, (event) => {
        event.preventDefault();
        dropzone.classList.remove('is-dragging');
    }));
    dropzone.addEventListener('drop', (event) => setFiles(event.dataTransfer.files));

    submit.addEventListener('click', () => {
        const error = validateSelection(selectedFiles);
        if (error || uploading) { setMessage(error, true); return; }
        const body = new FormData();
        selectedFiles.forEach((file) => body.append('evidencias', file, file.name));
        const request = new XMLHttpRequest();
        uploading = true;
        submit.disabled = true;
        progress.hidden = false;
        progressBar.style.width = '0%';
        submit.textContent = 'Enviando…';
        setMessage('Enviando evidencia…');
        request.open('POST', uploader.dataset.uploadUrl);
        request.setRequestHeader('x-csrf-token', uploader.dataset.csrfToken);
        request.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) progressBar.style.width = `${Math.round((event.loaded / event.total) * 100)}%`;
        });
        request.addEventListener('load', () => {
            let response = {};
            try { response = JSON.parse(request.responseText); } catch { response = {}; }
            if (request.status === 201) { window.location.reload(); return; }
            uploading = false;
            progress.hidden = true;
            submit.disabled = false;
            submit.textContent = 'Enviar evidencia';
            const messages = {
                404: 'La actividad no está disponible.',
                409: 'La actividad cambió. Recarga la página antes de intentarlo nuevamente.',
                422: 'Revisa los archivos seleccionados.',
                503: 'El servicio no está disponible temporalmente.'
            };
            setMessage(messages[request.status] || response.mensaje || 'No fue posible enviar la evidencia.', true);
        });
        request.addEventListener('error', () => {
            uploading = false;
            progress.hidden = true;
            submit.disabled = false;
            submit.textContent = 'Enviar evidencia';
            setMessage('No fue posible completar la carga.', true);
        });
        request.send(body);
    });
});
