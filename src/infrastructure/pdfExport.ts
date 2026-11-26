import { registerPlugin } from '@capacitor/core';
import type { FilePort } from '../application/index';

interface PdfExportPlugin {
  export: FilePort['exportPdf'];
}

export const PdfExport = registerPlugin<PdfExportPlugin>('PdfExport');
