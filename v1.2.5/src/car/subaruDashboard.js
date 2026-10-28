
let cluster, speedText, gearText, rpmText, needle, bar, lastCar = false;

function createDashboard() {
  if (cluster) return;

  const style = document.createElement('style');
  style.id = 'hood-subaru-dashboard-style';
  style.textContent = `
    #hood-subaru-dashboard {
      position: fixed; z-index: 30; left: 50%; bottom: 18px;
      transform: translateX(-50%); width: min(440px, 92vw);
      display: none; grid-template-columns: 1fr 1.25fr 1fr;
      align-items: center; gap: 12px; padding: 14px 18px 12px;
      color: #eaf4ff; pointer-events: none;
      background: linear-gradient(180deg, rgba(20,27,35,.96), rgba(5,8,12,.98));
      border: 1px solid rgba(110,160,190,.55); border-radius: 16px 16px 10px 10px;
      box-shadow: 0 0 24px rgba(0,0,0,.45), inset 0 1px rgba(255,255,255,.08);
      font-family: system-ui, sans-serif; box-sizing: border-box;
    }
    #hood-subaru-dashboard .hood-gauge {
      min-width: 0; text-align: center; border: 1px solid rgba(150,180,200,.22);
      border-radius: 10px; padding: 9px 5px; background: rgba(255,255,255,.025);
    }
    #hood-subaru-dashboard .hood-label {
      display: block; font-size: 9px; letter-spacing: 2px;
      color: #8fa8bb; font-weight: 700;
    }
    #hood-subaru-dashboard .hood-speed {
      display: block; font-size: clamp(32px, 7vw, 43px); line-height: 1.12;
      font-weight: 800; letter-spacing: -2px; font-variant-numeric: tabular-nums;
      color: #f5fbff;
    }
    #hood-subaru-dashboard .hood-unit {
      font-size: 9px; letter-spacing: 2px; color: #64d8ff; font-weight: 800;
    }
    #hood-subaru-dashboard .hood-gear {
      display: block; font-size: 30px; line-height: 1.15; font-weight: 800;
      color: #ffcf70;
    }
    #hood-subaru-dashboard .hood-rpm {
      display: block; font-size: 16px; font-weight: 750; margin-top: 7px;
      font-variant-numeric: tabular-nums;
    }
    #hood-subaru-dashboard .hood-track {
      height: 4px; margin-top: 8px; background: #25323d;
      border-radius: 4px; overflow: hidden;
    }
    #hood-subaru-dashboard .hood-bar {
      width: 0%; height: 100%; background: linear-gradient(90deg,#38c9e8,#f2c65d,#ff624f);
      transition: width 100ms linear;
    }
    #hood-subaru-dashboard .hood-brand {
      grid-column: 1 / -1; text-align: center; font-size: 8px;
      letter-spacing: 3px; font-weight: 800; color: #70889b; margin-top: -2px;
    }
    @media (max-width: 420px) {
      #hood-subaru-dashboard { bottom: 10px; gap: 6px; padding: 9px; }
      #hood-subaru-dashboard .hood-gauge { padding: 7px 3px; }
      #hood-subaru-dashboard .hood-speed { font-size: 31px; }
    }
  `;
  document.head.appendChild(style);

  cluster = document.createElement('div');
  cluster.id = 'hood-subaru-dashboard';
  cluster.innerHTML = `
    <div class="hood-gauge">
      <span class="hood-label">ENGINE</span>
      <span class="hood-rpm" id="hood-dash-rpm">0.0 x1000</span>
      <div class="hood-track"><div class="hood-bar" id="hood-dash-bar"></div></div>
    </div>
    <div class="hood-gauge">
      <span class="hood-label">ROAD SPEED</span>
      <span class="hood-speed" id="hood-dash-speed">000</span>
      <span class="hood-unit">KM/H</span>
    </div>
    <div class="hood-gauge">
      <span class="hood-label">GEAR</span>
      <span class="hood-gear" id="hood-dash-gear">N</span>
      <span class="hood-label">TRANSMISSION</span>
    </div>
    <div class="hood-brand">SUBARU · IMPREZA WRX STI</div>
  `;
  document.body.appendChild(cluster);
  speedText = cluster.querySelector('#hood-dash-speed');
  gearText = cluster.querySelector('#hood-dash-gear');
  rpmText = cluster.querySelector('#hood-dash-rpm');
  bar = cluster.querySelector('#hood-dash-bar');
}

export function updateSubaruDashboard({ speedKmh = 0, gear = 'N', throttle = 0, speed = 0, active = false, carName = '' } = {}) {
  createDashboard();
  const isSubaru = /subaru|wrx|sti/i.test(carName);
  const visible = isSubaru && active;
  cluster.style.display = visible ? 'grid' : 'none';
  if (!visible) return;

  speedText.textContent = String(Math.min(999, Math.max(0, speedKmh))).padStart(3, '0');
  gearText.textContent = gear === 'R' || gear === 'N' ? gear : `D${gear}`;

  // Estimated RPM for the visual cluster until engine RPM is exposed by the physics model.
  const rpm = Math.min(8.0, Math.max(0.8, 0.8 + Math.min(speedKmh / 32, 5.2) + throttle * 1.8));
  rpmText.textContent = `${rpm.toFixed(1)} x1000`;
  bar.style.width = `${Math.min(100, rpm / 8 * 100)}%`;
}
