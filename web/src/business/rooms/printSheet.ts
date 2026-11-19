// The print sheet (ADR-0451, BZ-0451-02): a table card per zone and one poster, built in the
// browser from the existing QR encoder and printed (or saved as a PDF) with the browser's own
// print dialog. Every word is escaped: venue and zone names come from people.

import { qrSvg } from '../../rooms/qr';
import { joinUrl, type PrintSheet } from './roomsClient';

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** The links each card's QR code holds, zone by zone. */
export function cardLinks(sheet: PrintSheet, origin: string): { zone: string; url: string }[] {
  return sheet.zones.map((zone) => ({ zone: zone.zone_name, url: joinUrl(zone.join_url, origin) }));
}

/** The whole printable page as HTML: cards first, then one poster per zone. */
export function printSheetHtml(sheet: PrintSheet, origin: string): string {
  const venue = escape(sheet.venue_name);
  const logo = sheet.logo_url ? `<img class="logo" src="${escape(sheet.logo_url)}" alt="">` : '';
  const card = (zone: PrintSheet['zones'][number], big: boolean) => {
    const url = joinUrl(zone.join_url, origin);
    const ask = zone.view_only ? 'Scan to see what is playing' : 'Scan to ask for a song';
    return `<section class="${big ? 'poster' : 'card'}">${logo}<p class="venue">${venue}</p><h1>${escape(zone.zone_name)}</h1>`
      + `<div class="qr">${qrSvg(url, `${zone.zone_name} request code`)}</div><p>${ask}</p><p class="code">Code ${escape(zone.code)}</p>`
      + '<p class="small">Powered by SelectaDJ</p></section>';
  };
  const style = 'body{font-family:system-ui,sans-serif;margin:0}.card{width:85mm;height:120mm;border:1px dashed #999;display:inline-block;'
    + 'vertical-align:top;margin:4mm;padding:6mm;box-sizing:border-box;text-align:center;page-break-inside:avoid}'
    + '.poster{page-break-before:always;text-align:center;padding:20mm}.poster .qr{width:120mm;margin:auto}.card .qr{width:50mm;margin:auto}'
    + '.code{font-weight:700;letter-spacing:.1em}.small{font-size:9pt;color:#555}.logo{max-height:14mm}.venue{margin:0}';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${venue} request cards</title><style>${style}</style></head>`
    + `<body>${sheet.zones.map((zone) => card(zone, false)).join('')}${sheet.zones.map((zone) => card(zone, true)).join('')}</body></html>`;
}

/** Open the sheet in a new window and ask the browser to print it. False when a pop-up blocker said no. */
export function openPrintSheet(sheet: PrintSheet, origin = window.location.origin): boolean {
  const opened = window.open('', '_blank');
  if (!opened) return false;
  opened.document.open();
  opened.document.write(printSheetHtml(sheet, origin));
  opened.document.close();
  opened.focus();
  opened.print();
  return true;
}
