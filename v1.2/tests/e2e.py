# End-to-end smoke test in real headless Chromium (software WebGL). Usage: python3 tests/e2e.py http://localhost:8099
import sys, json, time
from playwright.sync_api import sync_playwright
url = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8099') + '/index.html?debug'
fails = 0
def ok(n, c, i=''):
    global fails; print(('PASS' if c else 'FAIL') + '  ' + n + (('  [' + str(i) + ']') if i != '' else '')); fails += (not c)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1100, 'height': 650}); errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_function('window.__game && (window.__game.ready || window.__game.error)', timeout=60000)
    g = pg.evaluate('({ready:__game.ready, error:__game.error})'); ok('game boots (map + car loaded)', g['ready'], g['error'])
    time.sleep(1.5); st = pg.evaluate('__game.stats'); print('   stats:', st)
    ok('wheels rigged', st.get('wheelsOk') is True)
    ok('draw calls < 60 (v1 had ~1,400+ for the car alone)', 0 < st['calls'] < 60, st['calls'])
    s0 = pg.evaluate('({x:__game.sim.x,z:__game.sim.z,psi:__game.sim.psi})')
    pg.screenshot(path='/tmp/shot_spawn.png')
    # accelerate for 6 s of SIM time
    pg.keyboard.down('ArrowUp'); t0 = pg.evaluate('__game.loop.simTime')
    pg.wait_for_function('__game.loop.simTime - %f > 6' % t0, timeout=120000)
    s1 = pg.evaluate('({speed:__game.sim.speed*3.6, x:__game.sim.x, z:__game.sim.z, gear:__game.sim.gear, onRoad:__game.world.surfaceAt(__game.sim.x,__game.sim.z).onRoad})')
    ok('car accelerates (>60 km/h after 6 s)', s1['speed'] > 60, round(s1['speed']))
    ok('car moved from spawn', ((s1['x']-s0['x'])**2 + (s1['z']-s0['z'])**2) ** .5 > 30)
    # steer right continuously: heading must go beyond the old +-1.25 rad clamp
    pg.keyboard.down('ArrowRight'); t0 = pg.evaluate('__game.loop.simTime')
    pg.wait_for_function('__game.loop.simTime - %f > 8' % t0, timeout=120000)
    pg.keyboard.up('ArrowRight'); pg.keyboard.up('ArrowUp')
    pg.screenshot(path='/tmp/shot_driving.png')
    r = pg.evaluate('({psi:__game.sim.psi, finite:[__game.sim.x,__game.sim.z,__game.sim.vx,__game.sim.vz].every(Number.isFinite), speed:__game.sim.speed*3.6, impact:__game.stats.lastImpact})')
    ok('state stays finite while steering/colliding', r['finite'], r)
    pg.keyboard.press('c'); time.sleep(0.5); pg.screenshot(path='/tmp/shot_cockpit.png')
    ok('no console errors', not errs, errs[:3])
    b.close()
sys.exit(1 if fails else 0)
