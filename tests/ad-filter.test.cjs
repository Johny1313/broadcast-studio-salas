'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {requestBlocked,createAdFilter}=require('../electron/ad-filter.cjs');
const mk=(url,resourceType='script')=>({url,resourceType});
test('bloqueia redes de publicidade por domínio completo ou subdomínio',()=>{
  assert.equal(requestBlocked(mk('https://ad.doubleclick.net/pagead/ads'),'balanced'),true);
  assert.equal(requestBlocked(mk('https://securepubads.g.doubleclick.net/tag'),'balanced'),true);
  assert.equal(requestBlocked(mk('https://cdn.taboola.com/widget'),'balanced'),true);
  assert.equal(requestBlocked(mk('https://notdoubleclick.net/foo'),'balanced'),false);
});
test('preserva conteúdo do site e vídeos reais',()=>{
  for(const url of ['https://googlevideo.com/videoplayback','https://www.youtube-nocookie.com/embed/test','https://player.vimeo.com/video/123','https://my-news.example/article'])
    assert.equal(requestBlocked(mk(url),'enhanced'),false,url);
  assert.equal(requestBlocked(mk('https://ad.doubleclick.net/example','mainFrame'),'balanced'),false);
});
test('modo desativado libera requisições, reforçado bloqueia trackers',()=>{
  assert.equal(requestBlocked(mk('https://googleadservices.com/pagead'),'off'),false);
  assert.equal(requestBlocked(mk('https://www.google-analytics.com/analytics.js'),'balanced'),false);
  assert.equal(requestBlocked(mk('https://www.google-analytics.com/analytics.js'),'enhanced'),true);
});
test('listener Electron responde callback para todas as requisições e respeita mudanças de modo',()=>{
  let handler,scope;
  const mock={onBeforeRequest:(f,cb)=>{scope=f;handler=cb}};
  const filter=createAdFilter(mock);
  assert.deepEqual(scope.urls,['http://*/*','https://*/*']);
  let response;
  handler(mk('https://adsrvr.org/ads'),(res)=>response=res);
  assert.deepEqual(response,{cancel:true});
  assert.equal(filter.status().blocked,1);
  filter.setMode('off');
  handler(mk('https://adsrvr.org/ads'),(res)=>response=res);
  assert.deepEqual(response,{cancel:false});
  assert.equal(filter.status().blocked,1);
  assert.throws(()=>filter.setMode('unknown'));
});
