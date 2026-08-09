import QRCode from 'qrcode';
import { listModules } from '$lib/server/services/study';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  const moduleRows = await listModules(locals.user!.id);
  const labels = await Promise.all(
    moduleRows.map(async (module) => {
      const scanUrl = new URL('/scan', url.origin);
      scanUrl.searchParams.set('module', module.id);
      return {
        id: module.id,
        code: module.code,
        name: module.name,
        color: module.color,
        notebookName: module.notebookName,
        notebookNumber: module.notebookNumber,
        scanUrl: scanUrl.toString(),
        qr: await QRCode.toDataURL(scanUrl.toString(), {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 320,
          color: { dark: '#262522', light: '#ffffff' }
        })
      };
    })
  );
  return { labels };
};
