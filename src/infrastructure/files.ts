import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { FilePort, ScreenshotInput } from '../application/index';
import { PdfExport } from './pdfExport';

/** 把用户选的小米睡眠截图存进应用私有目录，返回相对路径 */
export async function saveScreenshot(file: ScreenshotInput, cycleId: string): Promise<string> {
  const blob =
    file instanceof Blob ? file : new Blob([await file.arrayBuffer()], { type: file.type });
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(blob);
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

function isWeb(): boolean {
  return !Capacitor.isNativePlatform();
}

export async function shareTextFile(filename: string, text: string): Promise<void> {
  if (isWeb()) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  await Filesystem.writeFile({
    path: `exports/${filename}`,
    directory: Directory.Cache,
    recursive: true,
    data: text,
    encoding: Encoding.UTF8,
  });
  const uri = await Filesystem.getUri({ path: `exports/${filename}`, directory: Directory.Cache });
  await Share.share({ title: filename, url: uri.uri, dialogTitle: '分享清醒记录' });
}

export const filePort: FilePort = {
  saveScreenshot,
  screenshotUrl,
  shareTextFile,
  exportPdf: (options) => PdfExport.export(options),
};
