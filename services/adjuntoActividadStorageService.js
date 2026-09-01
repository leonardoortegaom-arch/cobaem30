const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const storageRoot = path.resolve(__dirname, '..', 'storage', 'private', 'orientation-activity-attachments');
const tempDirectory = path.join(storageRoot, 'temp');
const finalDirectory = path.join(storageRoot, 'files');
const discardDirectory = path.join(storageRoot, 'discard');

const allowedTypes = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
    ['video/mp4', 'mp4'],
    ['video/webm', 'webm'],
    ['video/quicktime', 'mov'],
    ['application/pdf', 'pdf'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx']
]);

const ensureDirectories = async () => {
    await Promise.all([tempDirectory, finalDirectory, discardDirectory].map((directory) => (
        fs.promises.mkdir(directory, { recursive: true })
    )));
};

const ensureInside = (base, candidate) => {
    const resolvedBase = path.resolve(base);
    const resolvedCandidate = path.resolve(candidate);
    if (resolvedCandidate !== resolvedBase && !resolvedCandidate.startsWith(`${resolvedBase}${path.sep}`)) {
        throw new Error('INVALID_STORAGE_PATH');
    }
    return resolvedCandidate;
};

const sanitizeOriginalName = (value) => {
    const basename = path.basename(typeof value === 'string' ? value : '');
    const clean = basename
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
        .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
        .trim();
    return Array.from(clean || 'archivo').slice(0, 255).join('');
};

const hashFile = async (filePath) => {
    const hash = crypto.createHash('sha256');
    await pipeline(fs.createReadStream(filePath), hash);
    return hash.digest('hex');
};

const inspectFile = async (file) => {
    const { fileTypeFromFile } = await import('file-type');
    const detected = await fileTypeFromFile(file.path);
    if (!detected || !allowedTypes.has(detected.mime)) {
        const error = new Error('UNSUPPORTED_FILE_TYPE');
        error.status = 415;
        throw error;
    }
    const extension = allowedTypes.get(detected.mime);
    if (detected.ext !== extension && !(detected.mime === 'image/jpeg' && detected.ext === 'jpg')) {
        const error = new Error('UNSUPPORTED_FILE_SIGNATURE');
        error.status = 415;
        throw error;
    }
    return {
        tempPath: ensureInside(tempDirectory, file.path),
        originalName: sanitizeOriginalName(file.originalname),
        size: Number(file.size),
        mimeType: detected.mime,
        extension,
        hashSha256: await hashFile(file.path),
        storageKey: crypto.randomUUID()
    };
};

const finalPathFor = (storageKey, extension) => ensureInside(
    finalDirectory,
    path.join(finalDirectory, `${storageKey}.${extension}`)
);

const discardPathFor = (storageKey, extension) => ensureInside(
    discardDirectory,
    path.join(discardDirectory, `${storageKey}.${extension}.${crypto.randomUUID()}.deleting`)
);

const moveToFinal = async (file) => {
    const destination = finalPathFor(file.storageKey, file.extension);
    await fs.promises.rename(file.tempPath, destination);
    return destination;
};

const moveToDiscard = async ({ storageKey, extension }) => {
    const source = finalPathFor(storageKey, extension);
    const destination = discardPathFor(storageKey, extension);
    await fs.promises.rename(source, destination);
    return { source, destination };
};

const restoreFromDiscard = async ({ source, destination }) => {
    await fs.promises.rename(destination, source);
};

const removeFile = async (filePath) => {
    if (!filePath) return;
    const resolved = ensureInside(storageRoot, filePath);
    await fs.promises.rm(resolved, { force: true });
};

const cleanupFiles = async (paths) => {
    await Promise.allSettled(paths.filter(Boolean).map(removeFile));
};

const getDownloadFile = async ({ storageKey, extension }) => {
    const filePath = finalPathFor(storageKey, extension);
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) throw new Error('STORED_FILE_NOT_REGULAR');
    return { filePath, size: stats.size };
};

module.exports = {
    storageRoot,
    tempDirectory,
    ensureDirectories,
    inspectFile,
    moveToFinal,
    moveToDiscard,
    restoreFromDiscard,
    removeFile,
    cleanupFiles,
    getDownloadFile,
    sanitizeOriginalName
};
