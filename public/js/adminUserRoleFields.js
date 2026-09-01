document.addEventListener('DOMContentLoaded', () => {
    const roleSelect = document.getElementById('rol_id');
    const studentSection = document.getElementById('datos-alumno');
    const studentFields = Array.from(document.querySelectorAll('[data-alumno-field]'));
    const enrollmentInput = document.getElementById('matricula');
    const groupSelect = document.getElementById('grupo_id');

    if (!roleSelect || !studentSection || !enrollmentInput || !groupSelect) return;

    const updateStudentFields = () => {
        const selectedOption = roleSelect.options[roleSelect.selectedIndex];
        const isStudent = selectedOption?.dataset.clave === 'ALUMNO';

        studentSection.hidden = !isStudent;
        studentFields.forEach((field) => {
            field.hidden = !isStudent;
        });
        enrollmentInput.required = isStudent;
        groupSelect.required = isStudent;
        enrollmentInput.disabled = !isStudent;
        groupSelect.disabled = !isStudent;
    };

    roleSelect.addEventListener('change', updateStudentFields);
    updateStudentFields();
});
