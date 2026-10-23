// src/audio/audio.js — engine + radio, moved out of main.js UNCHANGED apart from exports/params (M3 replaces the radio scheduler).
import { CAR } from '../car/vehicle.js';
const $ = (id) => document.getElementById(id);

// ---------- Engine Audio ----------
let audio = null;

export function startAudio() {
  if (audio || !(window.AudioContext || window.webkitAudioContext)) {
    return;
  }

  const AudioContextClass =
  window.AudioContext || window.webkitAudioContext;

  const ctx = new AudioContextClass();
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 500;

  const master = ctx.createGain();
  master.gain.value = 0;
  lp.connect(master);
  master.connect(ctx.destination);

  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  const o3 = ctx.createOscillator();

  o1.type = "sawtooth";
  o2.type = "square";
  o3.type = "triangle";

  const g2 = ctx.createGain();
  const g3 = ctx.createGain();

  g2.gain.value = 0.5;
  g3.gain.value = 0.7;

  o1.connect(lp);
  o2.connect(g2).connect(lp);
  o3.connect(g3).connect(lp);

  const lfo = ctx.createOscillator();
  const lg = ctx.createGain();

  lfo.frequency.value = 14;
  lg.gain.value = 0.25;
  lfo.connect(lg).connect(master.gain);

  [o1, o2, o3, lfo].forEach((oscillator) => oscillator.start());

  audio = { ctx, o1, o2, o3, lp, master, lfo };

  if (ctx.state === "suspended") {
    ctx.resume().catch(console.warn);
  }
}

export function updateAudio(rpm, throttle) {
  if (!audio) return;

  const f = (rpm / 60) * 4;
  const t = audio.ctx.currentTime;

  audio.o1.frequency.setTargetAtTime(f, t, 0.04);
  audio.o2.frequency.setTargetAtTime(f / 2, t, 0.04);
  audio.o3.frequency.setTargetAtTime(f * 2, t, 0.04);
  audio.lp.frequency.setTargetAtTime(
    300 + rpm * 0.25 + throttle * 700,
    t,
    0.05
  );
  audio.lfo.frequency.setTargetAtTime(f / 3, t, 0.05);
  audio.master.gain.setTargetAtTime(
    0.1 + 0.14 * throttle + 0.04 * (rpm / CAR.redline),
                                    t,
                                    0.05
  );
}

// ---------- Radio / Music ----------
const RADIO_TRACKS = [
  {
    title: "Nightcall Overdrive",
    artist: "Challenger Synth FM",
    bpm: 118,
    bass: [55, 55, 65.41, 73.42, 61.74, 61.74, 49, 55],
    arp: [220, 261.63, 329.63, 440, 329.63, 261.63],
    url: null
  },
{
  title: "Hemi V8 Highway",
  artist: "Outrun 1970",
  bpm: 128,
  bass: [41.2, 41.2, 49, 55, 46.25, 46.25, 36.71, 41.2],
  arp: [164.81, 196, 246.94, 329.63, 246.94, 196],
  url: null
},
{
  title: "Midnight Canyon Run",
  artist: "R/T Electro",
  bpm: 110,
  bass: [65.41, 58.27, 49, 55, 65.41, 73.42, 82.41, 73.42],
  arp: [261.63, 329.63, 392, 523.25, 392, 329.63],
  url: null
},
{
  title: "Redline Horizon",
  artist: "Turbo Pulse",
  bpm: 136,
  bass: [49, 49, 58.27, 65.41, 73.42, 65.41, 58.27, 49],
  arp: [196, 233.08, 293.66, 392, 293.66, 233.08],
  url: null
}
];

let radioPlaying = false;
let currentTrackIndex = 0;
let radioVolume = 0.5;
let radioInterval = null;
let radioStep = 0;

const htmlAudio = new Audio();
htmlAudio.crossOrigin = "anonymous";
htmlAudio.loop = true;

function updateRadioUI() {
  const track = RADIO_TRACKS[currentTrackIndex];

  if ($("trackTitle")) {
    $("trackTitle").textContent = track.title;
  }

  if ($("trackArtist")) {
    $("trackArtist").textContent = radioPlaying
    ? track.artist
    : `${track.artist} · Paused`;
  }

  if ($("playBtn")) {
    $("playBtn").textContent = radioPlaying ? "⏸" : "▶";
    $("playBtn").classList.toggle("playing", radioPlaying);
  }
}

function playSynthStep() {
  if (!radioPlaying) return;

  startAudio();
  if (!audio || !audio.ctx) return;

  const ctx = audio.ctx;

  if (ctx.state === "suspended") {
    ctx.resume().catch(console.warn);
  }

  const track = RADIO_TRACKS[currentTrackIndex];
  const now = ctx.currentTime;
  const stepDur = 60 / track.bpm / 2;

  const bassFreq =
  track.bass[Math.floor(radioStep / 2) % track.bass.length];

  const bassOsc = ctx.createOscillator();
  const bassFilter = ctx.createBiquadFilter();
  const bassGain = ctx.createGain();

  bassOsc.type = "sawtooth";
  bassOsc.frequency.setValueAtTime(bassFreq, now);
  bassFilter.type = "lowpass";
  bassFilter.frequency.setValueAtTime(260, now);
  bassGain.gain.setValueAtTime(0.18 * radioVolume, now);
  bassGain.gain.exponentialRampToValueAtTime(
    0.001,
    now + stepDur * 0.9
  );

  bassOsc.connect(bassFilter).connect(bassGain).connect(ctx.destination);
  bassOsc.start(now);
  bassOsc.stop(now + stepDur);

  const arpFreq = track.arp[radioStep % track.arp.length];
  const arpOsc = ctx.createOscillator();
  const arpGain = ctx.createGain();

  arpOsc.type = "triangle";
  arpOsc.frequency.setValueAtTime(arpFreq, now);
  arpGain.gain.setValueAtTime(0.09 * radioVolume, now);
  arpGain.gain.exponentialRampToValueAtTime(
    0.001,
    now + stepDur * 0.85
  );

  arpOsc.connect(arpGain).connect(ctx.destination);
  arpOsc.start(now);
  arpOsc.stop(now + stepDur);

  radioStep++;
}

function startRadioPlayback() {
  stopRadioPlayback();

  const track = RADIO_TRACKS[currentTrackIndex];

  if (track.url) {
    htmlAudio.src = track.url;
    htmlAudio.volume = radioVolume;
    htmlAudio.play().catch(console.warn);
  } else {
    const stepMs = (60 / track.bpm / 2) * 1000;
    playSynthStep();
    radioInterval = setInterval(playSynthStep, stepMs);
  }
}

function stopRadioPlayback() {
  if (radioInterval) {
    clearInterval(radioInterval);
    radioInterval = null;
  }

  htmlAudio.pause();
}

export function toggleRadio() {
  radioPlaying = !radioPlaying;

  if (radioPlaying) {
    startRadioPlayback();
  } else {
    stopRadioPlayback();
  }

  updateRadioUI();
}

export function changeTrack(delta) {
  currentTrackIndex =
  (currentTrackIndex + delta + RADIO_TRACKS.length) %
  RADIO_TRACKS.length;

  radioStep = 0;

  if (radioPlaying) startRadioPlayback();
  updateRadioUI();
}

$("playBtn")?.addEventListener("click", toggleRadio);
$("prevBtn")?.addEventListener("click", () => changeTrack(-1));
$("nextBtn")?.addEventListener("click", () => changeTrack(1));

$("volumeSlider")?.addEventListener("input", (event) => {
  radioVolume = Number(event.target.value) / 100;
  htmlAudio.volume = radioVolume;
});

updateRadioUI();
