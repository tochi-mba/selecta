/** Explicit, local user-initiated save. No Cloud URL, fetch, or upload path. */
export async function saveArtifactFromUserGesture(
  artifact: File, name: string, maxBlobDownload = 64 * 1024 * 1024,
): Promise<'saved' | 'shared' | 'downloaded'> {
  if (!/^[-_. a-zA-Z0-9]{1,128}\.(wav|flac)$/.test(name)) throw new Error('Unsafe export filename');
  const picker = (window as Window & {
    showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;
  if (picker) {
    const handle = await picker({ suggestedName: name });
    const writable = await handle.createWritable();
    try {
      for (let pos = 0; pos < artifact.size; pos += 65536) {
        await writable.write(new Uint8Array(await artifact.slice(pos, pos + 65536).arrayBuffer()));
      }
      await writable.close();
    } catch (error) { await writable.abort(); throw error; }
    return 'saved';
  }
  if (artifact.size > maxBlobDownload) {
    throw new Error('Browser has no streaming Save picker. Large export remains in local OPFS; use a capable browser/device to save it.');
  }
  if (navigator.share && navigator.canShare?.({ files: [artifact] })) {
    await navigator.share({ files: [artifact], title: name });
    return 'shared';
  }
  const url = URL.createObjectURL(artifact);
  try {
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 30000); }
  return 'downloaded';
}
