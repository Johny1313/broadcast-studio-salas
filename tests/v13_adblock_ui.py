"""UI: browser mode shows limitation; mocked Electron bridge validates mode and preview reload."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
ROOT=Path(__file__).resolve().parent.parent
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1500,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content((ROOT/'index.html').read_text(),wait_until='domcontentloaded')
    page.add_style_tag(content=(ROOT/'styles.css').read_text())
    page.add_script_tag(content=(ROOT/'app.js').read_text())
    page.wait_for_function("document.querySelector('#adFilterMode').disabled")
    assert page.locator('#adFilterMode').input_value()=='off'
    assert 'Electron' in page.locator('#adFilterStatus').inner_text()
    assert errors==[],errors
    page.close()
    page=browser.new_page(viewport={'width':1500,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content((ROOT/'index.html').read_text(),wait_until='domcontentloaded')
    page.add_style_tag(content=(ROOT/'styles.css').read_text())
    page.evaluate("""() => {
      let mode='balanced';
      window.broadcastBridge = {
        adFilterStatus:async()=>({available:true,mode,blocked:3}),
        setAdFilterMode:async(next)=>({available:true,mode:(mode=next),blocked:3}),
        ffmpegStatus:async()=>({available:false}),
        onStatus:()=>()=>{}
      };
    }""")
    page.add_script_tag(content=(ROOT/'app.js').read_text())
    page.wait_for_function("document.querySelector('#adFilterBadge').textContent==='Desktop'")
    assert not page.locator('#adFilterMode').is_disabled()
    assert page.locator('#adFilterMode').input_value()=='balanced'
    page.locator('#adFilterMode').select_option('enhanced')
    page.wait_for_function("document.querySelector('#adFilterStatus').textContent.includes('reforçada')")
    page.locator('#adFilterMode').select_option('off')
    page.wait_for_function("document.querySelector('#adFilterStatus').textContent.includes('desligada')")
    assert errors==[],errors
    print(json.dumps({'result':'PASS','browser_mode':'selector disabled','electron_mode':'mocked IPC mode toggles work','runtime_errors':errors},ensure_ascii=False))
    browser.close()
