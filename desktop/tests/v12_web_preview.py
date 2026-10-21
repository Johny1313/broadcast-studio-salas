"""V1.2 E2E: URL preview OFF-AIR with mocked iframe content (network blocked in runner)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
ROOT=Path(__file__).resolve().parent.parent

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'])
    page=browser.new_page(viewport={'width':1720,'height':1040})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content((ROOT/'index.html').read_text(),wait_until='domcontentloaded')
    page.add_style_tag(content=(ROOT/'styles.css').read_text())
    # The testing sandbox blocks real external iframe navigation. Stub the iframe's
    # network document only; source assignment, layout, playlist and UI remain real.
    page.evaluate("""() => {
      const original=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'src');
      Object.defineProperty(HTMLIFrameElement.prototype,'src',{
        configurable:true,
        get(){return this.dataset.requestedUrl || original.get.call(this)},
        set(url){
          this.dataset.requestedUrl=String(url);
          this.srcdoc='<body style="background:#15475e;color:white;font:bold 18px system-ui;text-align:center;padding:12px"><h2 id="test-page">SITE INCORPORADO NA JANELA 4</h2><p>PRÉVIA SEM TRANSMISSÃO</p></body>';
        }
      });
    }""")
    page.add_script_tag(content=(ROOT/'app.js').read_text())
    page.wait_for_selector('#channelsH .channel-row')
    assert page.locator('#channelsH .channel-row').count()==4
    assert page.locator('#channelsV .channel-row').count()==4
    assert page.locator('#recordingState').inner_text()=='Inativa'
    assert page.locator('#rtmpCount').inner_text()=='0 ativas'
    # Generic page routes to slot 4 in both formats while live and recording stay OFF.
    page.locator('#mediaUrl').fill('https://preview.test/site_teste_offair.html')
    page.locator('#btnAddUrl').click()
    assert page.locator('#playlistCount').inner_text()=='1'
    page.locator('#btnRehearse').click()
    page.locator('#webOverlayH iframe').wait_for(state='visible',timeout=8000)
    page.locator('#webOverlayV iframe').wait_for(state='visible',timeout=8000)
    assert page.frame_locator('#webOverlayH iframe').locator('#test-page').inner_text()=='SITE INCORPORADO NA JANELA 4'
    assert page.frame_locator('#webOverlayV iframe').locator('#test-page').inner_text()=='SITE INCORPORADO NA JANELA 4'
    assert page.locator('#recordingState').inner_text()=='Inativa'
    assert page.locator('#rtmpCount').inner_text()=='0 ativas'
    page.screenshot(path=str(ROOT.parent/'BroadcastStudio-DualCanvas-V1.3.0-preview.png'),full_page=True)
    # Horizontal-only editing must not change the vertical layout.
    h_before=page.locator('#webOverlayH').evaluate('(el) => el.getBoundingClientRect().x')
    v_before=page.locator('#webOverlayV').evaluate('(el) => el.getBoundingClientRect().x')
    page.locator('#channelsH .channel-row').nth(3).locator('button').click()
    page.locator('#slotX').fill('30')
    page.locator('#slotX').dispatch_event('change')
    page.wait_for_timeout(300)
    h_after=page.locator('#webOverlayH').evaluate('(el) => el.getBoundingClientRect().x')
    v_after=page.locator('#webOverlayV').evaluate('(el) => el.getBoundingClientRect().x')
    assert abs(h_after-h_before)>4,(h_before,h_after)
    assert abs(v_after-v_before)<1,(v_before,v_after)
    # Webpages are NEVER inserted into program capture inadvertently.
    page.locator('#playlistAutoTake').check()
    page.locator('#btnTakeBoth').click()
    assert 'iframe não pode ser capturado' in page.locator('#logs').inner_text()
    assert page.locator('#webOverlayH iframe').count()==1
    assert page.locator('#webOverlayV iframe').count()==1
    # Pause removes iframe and resume restores it.
    page.locator('#btnPlay').click()
    page.wait_for_timeout(200)
    assert page.locator('#webOverlayH iframe').count()==0
    page.locator('#btnPlay').click()
    page.locator('#webOverlayH iframe').wait_for(state='visible',timeout=8000)
    # YouTube Shorts => official embed URL, linked to both slots.
    page.locator('#mediaUrl').fill('https://www.youtube.com/shorts/dQw4w9WgXcQ')
    page.locator('#btnAddUrl').click()
    assert page.locator('#playlistCount').inner_text()=='2'
    page.locator('#playlistList .playlist-item').last.locator('button').first.click()
    page.wait_for_function("document.querySelector('#webOverlayH iframe')?.src?.includes('youtube-nocookie.com/embed/dQw4w9WgXcQ')")
    # Vimeo routed to vertical only must preserve horizontal YouTube.
    page.locator('#mediaUrl').fill('https://vimeo.com/76979871')
    page.locator('#btnAddUrl').click()
    page.locator('#playlistTarget').select_option('v-media')
    page.locator('#playlistList .playlist-item').last.locator('button').first.click()
    page.wait_for_function("document.querySelector('#webOverlayV iframe')?.src?.includes('player.vimeo.com/video/76979871')")
    assert 'youtube-nocookie.com/embed' in page.locator('#webOverlayH iframe').get_attribute('data-requested-url')
    assert errors==[],errors
    print(json.dumps({'result':'PASS','iframe_contents':'mocked; remote platforms unverified','offair_no_live':True,'site_in_both_previews':True,'independent_geometry':True,'youtube_short_link':True,'vimeo_vertical_routing':True,'runtime_errors':errors},ensure_ascii=False))
    browser.close()
