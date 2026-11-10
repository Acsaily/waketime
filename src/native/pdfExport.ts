import { registerPlugin } from '@capacitor/core';

export interface PdfBlock {
  kind: 'title' | 'h2' | 'row' | 'para';
  text?: string;
  right?: string;
}

interface PdfExportPlugin {
  export(options: { filename: string; blocks: PdfBlock[]; share?: boolean }): Promise<{ path: string; size: number }>;
}

export const PdfExport = registerPlugin<PdfExportPlugin>('PdfExport');
