export async function encodeReferenceInput(sampleUrl, edits) {
  const reference = { sampleUrl, removeSample: Boolean(edits.removeSample) };
  if (edits.sampleUpload) {
    const file = edits.sampleUpload;
    if (file.size > 25_000_000) throw new Error('Choose an audio file smaller than 25 MB.');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('The audio file could not be read.'));
      reader.readAsDataURL(file);
    });
    reference.sampleUpload = { name: file.name, data: dataUrl.split(',')[1] };
    reference.removeSample = false;
  }
  return reference;
}
