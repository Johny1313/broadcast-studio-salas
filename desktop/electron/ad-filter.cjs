'use strict';
/**
 * Offline-first conservative content filter for embedded HTTP(S) pages in Electron.
 * Network rules cover only well-known advertising hosts; no ad service is queried.
 * Intentionally does not block first-party media, DRM, Google Video or iframe roots.
 * "Enhanced" additionally hides simple ad containers through safe local CSS.
 */
const AD_HOSTS = Object.freeze([
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'adnxs.com', 'criteo.com', 'criteo.net', 'adsrvr.org', 'taboola.com',
  'outbrain.com', 'pubmatic.com', 'openx.net', 'rubiconproject.com',
  'smartadserver.com', 'sharethrough.com', 'amazon-adsystem.com',
  'casalemedia.com', '3lift.com', 'teads.tv', 'mgid.com',
  'adform.net', 'adroll.com', 'media.net', 'yieldmo.com',
  'triplelift.com', 'lijit.com', 'indexww.com', 'contextweb.com',
  'spotxchange.com', 'sovrn.com', 'quantserve.com',
  'adsafeprotected.com','bidswitch.net','revcontent.com',
  'stickyadstv.com','smaato.net','kargo.com','onetrustads.com',
  'zedo.com','inmobi.com','adition.com','adobedtm.com',
  'seedtag.com','gumgum.com','undertone.com','advertising.com',
  'bidr.io','e-planning.net','richaudience.com','nativendo.com'
]);
const EXTRA_TRACKERS = Object.freeze([
  'google-analytics.com', 'scorecardresearch.com', 'chartbeat.com',
  'hotjar.com', 'newrelic.com', 'segment.io','mixpanel.com',
  'mouseflow.com','clarity.ms','fullstory.com'
]);
const MODES = Object.freeze(['off', 'balanced', 'enhanced']);
function hostMatches(host, rule) {return host === rule || host.endsWith('.'+rule);}
function requestBlocked(details, mode='balanced') {
  if (mode === 'off' || !details || details.resourceType === 'mainFrame') return false;
  let host;
  try {
    const url=new URL(details.url);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    host=url.hostname.toLowerCase();
  } catch (_) {return false;}
  // Hosts with legitimate streaming media (youtube, googlevideo, vimeo) are
  // never matched. All blocks use complete domain/subdomain matches.
  const list=mode === 'enhanced' ? [...AD_HOSTS, ...EXTRA_TRACKERS] : AD_HOSTS;
  return list.some(rule => hostMatches(host, rule));
}
function createAdFilter(webRequest) {
  let mode='balanced', count=0;
  webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (details,callback)=>{
    const cancel=requestBlocked(details,mode);
    if (cancel) count+=1;
    callback({cancel});
  });
  return {
    status:()=>({available:true,mode,blocked:count}),
    setMode:(next)=>{if (!MODES.includes(next)) throw new Error('Modo de filtro inválido');mode=next;return {available:true,mode,blocked:count};},
    getMode:()=>mode
  };
}
// Cosmetic rules are intentionally narrow; hide known ad boxes, not article content.
const COSMETIC_CSS = [
  'ins.adsbygoogle', '[data-ad-client]', '[id^="google_ads_iframe_"]',
  'iframe[src*="doubleclick.net"]', 'iframe[src*="googlesyndication.com"]',
  '[data-testid="ad-banner"]', '.advertisement', '.ad-banner',
  '#ad-container', '.ad-container', '[aria-label=\"Advertisement\"]',
  '[data-ad-slot]', '[data-adunit]', '[data-ad-unit]',
  '.adsbox', '.ad-placeholder', '.advertising', '.advertisement-container'
].join(',') + '{display:none!important;visibility:hidden!important;pointer-events:none!important;}';
module.exports={createAdFilter,requestBlocked,AD_HOSTS,EXTRA_TRACKERS,COSMETIC_CSS};
