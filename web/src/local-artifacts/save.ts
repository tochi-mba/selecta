/** Explicit, local user-initiated save. No Cloud URL, fetch, or upload path. */
export async function saveArtifactFromUserGesture(
  artifact: File, name: string,
): Promise<'saved' | 'shared' | 'downloaded'> {
  if (!/^[-_. a-zA-Z0-9]{1,128}\.(wav|flac)$/.test(name)) throw new Error('Unsafe export filename');
  const picker = (window as Window & {
    showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;
  if (picker) {
    const handle = await picker.call(window, { suggestedName: name });
    const writable = await handle.createWritable();
    try {
      for (let pos = 0; pos < artifact.size; pos += 65536) {
        await writable.write(new Uint8Array(await artifact.slice(pos, pos + 65536).arrayBuffer()));
      }
      await writable.close();
    } catch (error) { await writable.abort(); throw error; }
    return 'saved';
  }
  // File-backed object URLs permit user-initiated downloads without constructing
  // a whole-mix PCM ArrayBuffer in JS; browser-side buffering still varies.
  if (artifact.size <= 64 * 1024 * 1024 && navigator.share && navigator.canShare?.({ files: [artifact] })) {
    await navigator.share({ files: [artifact], title: name });
    return 'shared';
  }
  const url = URL.createObjectURL(artifact);
  try {
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 300000); }
  return 'downloaded';
}
