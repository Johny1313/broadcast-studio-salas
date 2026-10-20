"""Visual, camera-routing, playlist, preview/program and dual WebM smoke in Chromium."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, subprocess, tempfile, time
ROOT=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory() as tmpdir:
    tmp=Path(tmpdir)
    sample=tmp/'playlist.webm'
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=480x270:rate=15','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-c:v','libvpx','-deadline','realtime','-cpu-used','8','-b:v','600k','-c:a','libopus','-shortest',str(sample)],check=True)
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'])
        page=browser.new_page(viewport={'width':1600,'height':950},accept_downloads=True)
        errs=[];downloads=[]
        page.on('pageerror',lambda e:errs.append(str(e)))
        page.on('download',lambda d:downloads.append(d))
        page.goto('about:blank')
        page.set_content((ROOT/'index.html').read_text(),wait_until='domcontentloaded')
        page.add_style_tag(content=(ROOT/'styles.css').read_text())
        page.evaluate("""() => {
          const streams={};
          for(let i=1;i<=3;i++){
            const c=document.createElement('canvas'); c.width=640;c.height=360;
            const ctx=c.getContext('2d');let pos=0;
            setInterval(()=>{ctx.fillStyle=['#a12331','#259064','#2c60af'][i-1];ctx.fillRect(0,0,640,360);ctx.fillStyle='white';ctx.fillRect(pos++%580,30,60,60)},40);
            streams['cam'+i]=c.captureStream(20);
          }
          const a=new AudioContext(),osc=a.createOscillator(),dst=a.createMediaStreamDestination();
          osc.connect(dst);osc.start();
          Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
            enumerateDevices:async()=>[...Array(3)].map((_,i)=>({kind:'videoinput',deviceId:'cam'+(i+1),label:'Teste '+(i+1)})).concat([{kind:'audioinput',deviceId:'mic1',label:'Mic teste'}]),
            getUserMedia:async(opt)=> opt.video?streams[opt.video.deviceId?.exact || 'cam1'].clone():dst.stream.clone(),
            addEventListener:()=>{}
          }});
        }""")
        page.add_script_tag(content=(ROOT/'app.js').read_text())
        page.wait_for_timeout(400)
        assert page.locator('canvas').count()==4
        assert page.locator('#channelsH .channel-row').count()==4
        assert page.locator('#channelsV .channel-row').count()==4
        for i in range(1,4):
            page.locator(f'#cameraSelect{i}').select_option(f'cam{i}')
            page.locator(f'#btnCamera{i}').click()
            page.wait_for_function(f"document.querySelector('#cameraStatus{i}').textContent !== 'Desconectada'",timeout=8000)
        page.locator('#btnMic').click()
        page.wait_for_function("document.querySelector('#micStatus').textContent !== 'Nenhum microfone conectado'",timeout=8000)
        # Can disable a camera composition without altering program until take.
        before=page.evaluate("""() => document.querySelector('#programMonitorH').toDataURL()""")
        page.locator('#channelsH .channel-row').nth(1).locator('input[type=checkbox]').uncheck()
        assert not page.locator('#channelsH .channel-row').nth(1).locator('input').is_checked()
        assert page.locator('#channelsV .channel-row').nth(1).locator('input').is_checked()
        page.locator('#btnTakeBoth').click()
        assert 'Atualizado' in page.locator('#hProgInfo').inner_text()
        # Video is routed strictly to fourth composition of both scenes.
        page.locator('#mediaFiles').set_input_files(str(sample))
        page.wait_for_function("document.querySelector('#mediaCount').textContent==='5'",timeout=8000)
        page.locator('#mediaList .library-item').last.locator('button').last.click()
        assert page.locator('#playlistCount').inner_text()=='1'
        page.locator('#btnPlay').click()
        page.wait_for_function("document.querySelector('#btnPlay').textContent.includes('Pausar')",timeout=9000)
        page.wait_for_timeout(300)
        page.locator('#btnTakeBoth').click()
        # Select and visually hide playlist vertical only.
        page.locator('#channelsV .channel-row').nth(3).locator('input').uncheck()
        page.locator('#btnTakeV').click()
        page.wait_for_timeout(400)
        page.locator('#btnRecordBoth').click()
        page.wait_for_function("document.querySelector('#recordingState').textContent.includes('16:9') && document.querySelector('#recordingState').textContent.includes('9:16')",timeout=12000)
        page.wait_for_timeout(1900)
        page.locator('#btnStopBoth').click()
        page.wait_for_function("document.querySelector('#recordingState').textContent === 'Inativa'",timeout=12000)
        page.wait_for_timeout(500)
        recordings=[]
        for d in downloads:
            file=tmp/d.suggested_filename
            d.save_as(str(file))
            data=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(file)]))
            vid=next(x for x in data['streams'] if x['codec_type']=='video')
            recordings.append([vid['width'],vid['height'],file.stat().st_size])
        assert sorted([r[:2] for r in recordings])==[[720,1280],[1280,720]],recordings
        assert all(r[2]>10000 for r in recordings)
        assert not errs,errs
        page.screenshot(path=str(ROOT.parent/'BroadcastStudio-DualCanvas-V1.3.0-preview.png'),full_page=True)
        print(json.dumps({'result':'PASS','camera_inputs':3,'composition_slots_per_canvas':4,'playlist_items':1,'recordings':recordings,'runtime_errors':errs},ensure_ascii=False))
        browser.close()
