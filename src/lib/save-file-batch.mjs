export async function saveFilesSequentially(files, saveFile) {
  const saved = [];
  const failed = [];
  for (const file of files) {
    try {
      if (await saveFile(file)) saved.push(file);
      else failed.push(file);
    } catch {
      failed.push(file);
    }
  }
  return { saved, failed };
}
