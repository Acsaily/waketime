import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

/** 把用户选的小米睡眠截图存进应用私有目录，返回相对路径 */
export async function saveScreenshot(file: File, cycleId: string): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const path = `sleep-shots/${cycleId}.jpg`;
  await Filesystem.writeFile({ path, directory: Directory.Data, data: base64, recursive: true });
  return path;
}

/** 私有目录里的图片 -> 能直接给 <img src> 用的地址 */
export async function screenshotUrl(path: string): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
    return Capacitor.convertFileSrc(uri);
  } catch {
    return null;
  }
}
