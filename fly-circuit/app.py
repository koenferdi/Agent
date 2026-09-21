#!/usr/bin/env python3
"""Fly Circuit Lab: synthetic Drosophila-inspired circuit, not a biological twin.
Python 3.10+. Install requirements.txt; run python app.py. See README.md for TLS.
All model, API, streaming and embedded UI code lives in this file.
"""
from __future__ import annotations

import atexit
import getpass
import hashlib
import hmac
import json
import logging
import math
import os
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlsplit

import numpy as np
from flask import Flask, Response, abort, g, jsonify, render_template_string, request

GROUPS = ('sensory_inputs', 'central_complex', 'motor_descending')
LOG = logging.getLogger('flylab')


@dataclass(frozen=True)
class Connectome:
    """weights[post, pre] in mV-equivalent drive units. Columns obey Dale's law.

    This is a seeded synthetic graph, NOT an anatomical connectome. A future
    empirical adapter can return this structure after explicit mapping of
    transmitter signs and calibrated synaptic strengths.
    """
    neurons: tuple[dict, ...]
    weights: np.ndarray
    masks: dict[str, np.ndarray]

    @classmethod
    def mock(cls, seed: int = 42) -> 'Connectome':
        rng = np.random.default_rng(seed)
        sizes = (32, 80, 32)
        labels = np.repeat(np.arange(3), sizes)
        n = len(labels)
        inhibitory = rng.random(n) < .20
        # P[post group, pre group]: feedforward drive plus recurrent/feedback edges.
        probability = np.array([[.06, .025, .01], [.24, .11, .045], [.025, .25, .07]])
        connected = rng.random((n, n)) < probability[labels[:, None], labels[None, :]]
        # A directed ring guarantees every neuron participates in the graph.
        connected[(np.arange(n) + 1) % n, np.arange(n)] = True
        np.fill_diagonal(connected, False)
        weights = connected * rng.uniform(2.0, 4.5, (n, n))
        # Additional synthetic bilateral pathways: sensory left/right -> central
        # left/right -> matching turn cells, with both halves driving forward.
        for pre_ids, post_ids in ((range(0,16), range(32,72)),
                                 (range(16,32), range(72,112)),
                                 (range(32,72), range(128,136)),
                                 (range(72,112), range(136,144)),
                                 (range(32,112), range(112,128))):
            for pre in pre_ids:
                for post in post_ids:
                    if not inhibitory[pre] and rng.random() < .30:
                        weights[post, pre] = rng.uniform(3.0, 5.0)
        weights *= np.where(inhibitory, -1.4, 1.0)[None, :]
        masks = {name: labels == k for k, name in enumerate(GROUPS)}
        neurons = []
        for k, (name, size) in enumerate(zip(GROUPS, sizes)):
            for local in range(size):
                # 16 columns; three horizontal group bands on the responsive canvas.
                neurons.append(dict(id=len(neurons), group=name,
                                    inhibitory=bool(inhibitory[len(neurons)]),
                                    channel=('left_antenna' if local < 16 else 'right_antenna') if k == 0 else
                                            (('left_processing' if local < 40 else 'right_processing') if k == 1 else
                                             ('forward' if local < 16 else ('left' if local < 24 else 'right'))),
                                    x=(local % 16 + .5) / 16,
                                    y=(k + .17 + .66 * (local // 16 + .5) / math.ceil(size / 16)) / 3))
        weights.setflags(write=False)
        return cls(tuple(neurons), weights, masks)

    def graph(self) -> dict:
        post, pre = np.nonzero(self.weights)
        return {'source': 'seeded synthetic mock; no anatomical data',
                'neurons': self.neurons, 'groups': GROUPS,
                'edges': [{'source': int(b), 'target': int(a),
                           'weight': round(float(self.weights[a, b]), 3)}
                          for a, b in zip(post, pre)]}


class VirtualEnvironment:
    """Closed-loop 100 x 100 arena, bilateral odor sensors and neural actuation.

    Coordinates are arbitrary arena units. Odor and reward are dimensionless.
    The food source is stationary. Reward is measured, not a learning rule.
    The ethanol slider changes neural physiology independently of food odor.
    """
    width = height = 100.0
    source_x, source_y = 75.0, 30.0
    odor_sigma = 38.0
    source_radius = 6.0

    def __init__(self):
        self.x, self.y, self.heading = 25.0, 70.0, -.6
        self.forward_speed = self.turn_rate = 0.0
        self.reward = self.reward_integral = self.time_at_source_s = 0.0
        self.motor_hz = np.zeros(3)  # forward, left, right
        self.path = [(self.x, self.y)]

    def odor_at(self, x: float, y: float) -> float:
        d2 = (x - self.source_x) ** 2 + (y - self.source_y) ** 2
        return math.exp(-d2 / (2 * self.odor_sigma ** 2))

    def antenna_signals(self) -> tuple[float, float]:
        # Canvas coordinates: y increases downward; negative rotation is left.
        return tuple(self.odor_at(self.x + 5 * math.cos(self.heading + a),
                                  self.y + 5 * math.sin(self.heading + a))
                     for a in (-.65, .65))

    def advance(self, motor_spikes: np.ndarray, dt: float):
        # 16 forward cells, 8 left-turn cells, 8 right-turn cells. No direct
        # odor-gradient steering: movement can only originate from motor spikes.
        instantaneous = np.array([motor_spikes[:16].mean(),
                                  motor_spikes[16:24].mean(),
                                  motor_spikes[24:].mean()]) / dt
        decay = math.exp(-dt / .050)
        self.motor_hz = decay * self.motor_hz + (1 - decay) * instantaneous
        self.forward_speed = 18.0 * float(np.clip(self.motor_hz[0] / 60, 0, 1))
        self.turn_rate = 2.8 * float(np.clip((self.motor_hz[2] - self.motor_hz[1]) / 60, -1, 1))
        self.heading = (self.heading + self.turn_rate * dt + math.pi) % (2 * math.pi) - math.pi
        nx = self.x + math.cos(self.heading) * self.forward_speed * dt
        ny = self.y + math.sin(self.heading) * self.forward_speed * dt
        # Reflect at walls; the wall is a physical constraint, not a navigation cue.
        if nx < 1 or nx > 99:
            self.heading = math.pi - self.heading
        if ny < 1 or ny > 99:
            self.heading = -self.heading
        self.heading = (self.heading + math.pi) % (2 * math.pi) - math.pi
        self.x, self.y = float(np.clip(nx, 1, 99)), float(np.clip(ny, 1, 99))
        distance = math.hypot(self.x - self.source_x, self.y - self.source_y)
        self.reward = math.exp(-distance ** 2 / (2 * self.source_radius ** 2))
        self.reward_integral += self.reward * dt
        if distance <= self.source_radius:
            self.time_at_source_s += dt

    def snapshot(self) -> dict:
        self.path.append((round(self.x, 3), round(self.y, 3)))
        self.path = self.path[-300:]  # Last 30 seconds; fixed memory budget.
        left, right = self.antenna_signals()
        return {'width': self.width, 'height': self.height,
                'x': self.x, 'y': self.y, 'heading_rad': self.heading,
                'source': {'x': self.source_x, 'y': self.source_y,
                           'radius': self.source_radius, 'kind': 'food',
                           'odor_sigma': self.odor_sigma},
                'distance_to_source': math.hypot(self.x-self.source_x, self.y-self.source_y),
                'odor_strength': self.odor_at(self.x, self.y),
                'antenna_left': left, 'antenna_right': right,
                'speed_units_s': self.forward_speed, 'turn_rad_s': self.turn_rate,
                'motor_channels_hz': dict(zip(('forward', 'left', 'right'), self.motor_hz.tolist())),
                'reward': self.reward, 'reward_integral': self.reward_integral,
                'time_at_source_s': self.time_at_source_s, 'trail': self.path.copy()}


class LIFNetwork:
    """Euler-Maruyama LIF with exponential synaptic drive and event delay queue.

    dt=1 ms, tau_m=20 ms, tau_syn=10 ms, rest/reset=-65 mV,
    threshold=-50 mV, absolute refractory=3 ms.
    dV = (rest-V+drive)*dt/tau_m + sigma*sqrt(dt/tau_m)*N(0,1).
    Ethanol is a dimensionless phenomenological control, not a dose model.
    Access only under Simulation.lock when running in the server.
    """
    dt = .001
    tau_m = .020
    tau_syn = .010
    frame_steps = 100
    rest = -65.0
    threshold = -50.0

    def __init__(self, connectome: Connectome, seed: int = 7):
        self.connectome = connectome
        self.seed = seed
        self.n = len(connectome.neurons)
        self.stimulation = .55
        self.ethanol_concentration = 0.0
        self.reset()

    def reset(self):
        self.rng = np.random.default_rng(self.seed)
        self.environment = VirtualEnvironment()
        self.v = np.full(self.n, self.rest)
        self.syn = np.zeros(self.n)
        self.refractory = np.zeros(self.n, dtype=int)
        # Maximum delay=12 ms; >12 slots prevents circular-queue aliasing.
        self.pending = np.zeros((16, self.n))
        self.step_number = 0
        self.total_spikes = 0
        self.trial_id = secrets.token_hex(6)
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.history = np.zeros((10, self.n), dtype=np.int64)
        self.frames = 0

    def step(self) -> np.ndarray:
        e = self.ethanol_concentration
        slot = self.step_number % len(self.pending)
        self.syn *= math.exp(-self.dt / self.tau_syn)
        self.syn += self.pending[slot]
        self.pending[slot].fill(0)
        baseline = np.full(self.n, 10.0)
        left_odor, right_odor = self.environment.antenna_signals()
        # A tonic exploratory input avoids an absorbing silent state far from food.
        # The slider is sensory gain. Distance controls the odor-dependent fraction.
        sensory_signal = np.repeat([left_odor, right_odor], 16)
        baseline[self.connectome.masks['sensory_inputs']] += (
            32 * self.stimulation * (.35 + .65 * sensory_signal))
        # Increased leak toward rest is produced by attenuating depolarizing drive.
        drive = (baseline + self.syn) * (1 - .65 * e)
        sigma = 1.8 + 4.0 * e
        available = self.refractory == 0
        self.refractory[~available] -= 1
        dv = (self.rest - self.v + drive) * self.dt / self.tau_m
        dv += sigma * math.sqrt(self.dt / self.tau_m) * self.rng.standard_normal(self.n)
        self.v[available] += dv[available]
        self.v[~available] = self.rest
        spiking = available & (self.v >= self.threshold)
        self.v[spiking] = self.rest
        self.refractory[spiking] = 3
        if spiking.any():
            delay = 2 + round(10 * e)
            destination = (self.step_number + delay) % len(self.pending)
            # Sum active columns rather than doing a BLAS matrix multiply every ms.
            self.pending[destination] += self.connectome.weights[:, spiking].sum(axis=1)
        self.environment.advance(spiking[self.connectome.masks['motor_descending']], self.dt)
        self.step_number += 1
        return spiking

    def frame(self) -> dict:
        counts = np.zeros(self.n, dtype=np.int64)
        for _ in range(self.frame_steps):
            counts += self.step()
        self.history[self.frames % len(self.history)] = counts
        self.frames += 1
        elapsed = min(self.frames, len(self.history)) * self.frame_steps * self.dt
        rates = self.history.sum(axis=0) / elapsed
        self.total_spikes += int(counts.sum())
        return {'trial_id': self.trial_id, 'trial_started_at': self.started_at,
                'timestamp_utc': datetime.now(timezone.utc).isoformat(),
                'trial_timestamp_s': round(self.step_number * self.dt, 3),
                'environment': self.environment.snapshot(),
                'window_ms': 100, 'spikes': int(counts.sum()),
                'total_spikes': self.total_spikes,
                'active_neuron_count': int(np.count_nonzero(counts)),
                'active_ids': np.flatnonzero(counts).tolist(),
                'firing_rates_hz': {name: round(float(rates[mask].mean()), 3)
                                    for name, mask in self.connectome.masks.items()},
                'rate_window_s': round(elapsed, 3),
                'stimulation': self.stimulation,
                'ethanol_concentration': self.ethanol_concentration,
                'transmission_delay_ms': 2 + round(10 * self.ethanol_concentration)}


class Simulation:
    """One producer for all clients; latest snapshot only, no unbounded queues."""
    def __init__(self, connectome: Connectome):
        self.lock = threading.Condition(threading.RLock())
        self.model = LIFNetwork(connectome)
        self.stop_event = threading.Event()
        self.thread = None
        self.latest = None
        self.sequence = 0
        self.failure = None
        self.stream_slots = threading.BoundedSemaphore(8)

    def start(self):
        with self.lock:
            if self.thread is None:
                self.thread = threading.Thread(target=self._run, name='lif-simulator', daemon=True)
                self.thread.start()

    def close(self):
        self.stop_event.set()
        with self.lock:
            self.lock.notify_all()
        if self.thread:
            self.thread.join(timeout=3)

    def _run(self):
        try:
            deadline = time.monotonic()
            while not self.stop_event.is_set():
                start = time.monotonic()
                with self.lock:
                    snapshot = self.model.frame()
                    self.sequence += 1
                    snapshot['sequence'] = self.sequence
                    snapshot['compute_ms'] = round((time.monotonic() - start) * 1000, 2)
                    self.latest = snapshot
                    self.lock.notify_all()
                deadline += .1
                # Preserve numerical dt; don't spin in unbounded catch-up on slow VPSs.
                delay = deadline - time.monotonic()
                if delay < 0:
                    deadline = time.monotonic()
                self.stop_event.wait(max(0, delay))
        except Exception:
            LOG.exception('Simulation stopped unexpectedly')
            with self.lock:
                self.failure = 'Simulation failed; inspect server logs.'
                self.lock.notify_all()


PAGE = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fly Circuit Lab</title><style nonce="{{ nonce }}">
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#09111b;color:#e8f2fa}
*{box-sizing:border-box}body{margin:0}main{max-width:1000px;margin:auto;padding:24px 16px 40px}
h1{font-size:clamp(26px,5vw,40px);margin:8px 0}p{color:#9cacc0;line-height:1.6}.eyebrow{color:#66dec0;letter-spacing:.14em;font-size:12px}
header{display:flex;gap:12px;justify-content:space-between;align-items:center}#status{font-size:13px;color:#ffcf7b}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.card,.panel{background:#111e2c;border:1px solid #253649;border-radius:16px;padding:18px}
.card span{display:block;color:#9cacc0;font-size:12px}.card strong{display:block;font-size:30px;margin-top:8px;font-variant-numeric:tabular-nums}
.layout{display:grid;grid-template-columns:1.6fr 1fr;gap:16px}h2{font-size:17px;margin:0 0 16px}canvas{width:100%;height:390px;display:block}
.arena-panel{margin-bottom:16px}.arena-layout{display:grid;grid-template-columns:1.2fr 1fr;gap:20px}#arena{height:auto;aspect-ratio:1;background:#0b1722;border-radius:12px}.arena-info p{font-size:13px}.arena-info small{line-height:2}
.legend{font-size:12px;color:#b0c1d1;display:flex;gap:16px;flex-wrap:wrap}.controls label{display:block;margin-top:24px;font-size:14px}
input[type=range]{width:100%;height:44px;accent-color:#66dec0}output{float:right;font-variant-numeric:tabular-nums;color:#66dec0}
button{min-height:44px;padding:10px 16px;background:#243d50;color:#f0f7ff;border:1px solid #48647b;border-radius:10px;cursor:pointer;width:100%;margin-top:18px}
button:disabled{opacity:.5}small{color:#a4b5c9;line-height:1.5;display:block}#error{color:#ffb4a7;min-height:24px;margin-top:12px}footer{font-size:12px;color:#93a8bf;margin-top:20px;line-height:1.7}
@media(max-width:680px){.metrics{grid-template-columns:repeat(2,1fr)}.layout,.arena-layout{grid-template-columns:1fr}main{padding-top:18px}.card strong{font-size:27px}canvas{height:370px}header{align-items:start}}
</style></head><body><main><header><div><div class="eyebrow">COMPUTATIONAL NEUROSCIENCE / SANDBOX</div><h1>Fly Circuit Lab</h1></div><div id="status" role="status">Connecting…</div></header>
<p>A synthetic 144-neuron circuit. Explore sensory drive, central processing and descending motor activity.</p>
<section class="metrics" aria-label="Live metrics">
<div class="card"><span>SPIKES / 100 ms</span><strong id="spikes">—</strong></div>
<div class="card"><span>ACTIVE / 144</span><strong id="active">—</strong></div>
<div class="card"><span>CENTRAL · Hz / neuron</span><strong id="central">—</strong></div>
<div class="card"><span>MOTOR · Hz / neuron</span><strong id="motor">—</strong></div></section>
<section class="panel arena-panel"><h2>Virtuele geuromgeving</h2>
<div class="arena-layout"><canvas id="arena" role="img" aria-label="Live vlieg in een tweedimensionale ruimte met voedselbron en bewegingsspoor"></canvas>
<div class="arena-info"><div class="eyebrow">GESLOTEN SENSORIMOTORISCHE LUS</div><p>Geur → sensorische neuronen → centrale verwerking → motorneuronen → beweging.</p>
<small>Positie: <span id="position">—</span><br>Afstand tot voedsel: <span id="distance">—</span><br>Geur links / rechts: <span id="odor">—</span><br>Snelheid: <span id="speed">—</span> eenh./s<br>Beloning (0–1): <span id="reward">—</span><br>Tijd bij voedsel: <span id="dwell">—</span> s</small>
<p>De stip is voedsel; het spoor toont de laatste 30 seconden. Motorcellen sturen vooruit, links en rechts. De beloning wordt gemeten; dit model leert nog niet.</p></div></div></section>
<div class="layout"><section class="panel"><h2>Network activity</h2><canvas id="network" aria-label="Sensory, central and motor neurons; bright nodes fired in the latest 100 millisecond window" role="img"></canvas><div class="legend"><span>● Excitatory</span><span>◇ Inhibitory</span><span>Bright = fired</span></div></section>
<section class="panel controls"><h2>Environment</h2><small>Controls affect the shared trial in every connected browser.</small>
<label for="stimulation">Sensory stimulation <output id="stimValue" for="stimulation">0.55</output></label><input id="stimulation" type="range" min="0" max="1" step="0.01" value="0.55">
<label for="ethanol">Ethanol / break modifier <output id="ethanolValue" for="ethanol">0.00</output></label><input id="ethanol" type="range" min="0" max="1" step="0.01" value="0"><small>Higher values reduce neural drive, increase noise and lengthen synaptic delay. This scale is not a biological concentration.</small>
<button id="reset" type="button">Restart trial with current controls</button><div id="error" role="alert"></div>
<small>Trial: <span id="clock">0.0</span> s<br>Total spikes: <span id="total">0</span><br>Transmission delay: <span id="delay">2</span> ms</small></section></div>
<footer>Seeded mock connectome · LIF integration: 1 ms · Broadcast: 10 Hz<br>Rates: mean per neuron over the last 1 s (shorter at startup). Active neurons: unique neurons firing in the latest 100 ms. Educational model; not a validated fly digital twin or a reproduction of Melius FlyBreak.</footer>
<script nonce="{{ nonce }}">
'use strict';
const $=id=>document.getElementById(id), canvas=$('network'), ctx=canvas.getContext('2d');
let world=null;
let graph=null, lit=new Set(), lastMetric=0, dirty=false, busy=false, timer;
const colors={sensory_inputs:'#69dfc2',central_complex:'#a99bff',motor_descending:'#ffbd75'};
function draw(){
 const box=canvas.getBoundingClientRect(), dpr=Math.min(devicePixelRatio||1,2);
 canvas.width=Math.round(box.width*dpr);canvas.height=Math.round(box.height*dpr);ctx.scale(dpr,dpr);
 if(!graph)return;
 const point=n=>[10+n.x*(box.width-20),18+n.y*(box.height-26)];
 ctx.lineWidth=.5;ctx.strokeStyle='#263b4e';ctx.globalAlpha=.45;
 // Draw a deterministic subset for legibility; API provides the complete graph.
 graph.edges.filter((_,i)=>i%8===0).forEach(e=>{const a=point(graph.neurons[e.source]),b=point(graph.neurons[e.target]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke()});
 ctx.globalAlpha=1;ctx.font='11px system-ui';
 ['SENSORY INPUTS','CENTRAL COMPLEX','MOTOR DESCENDING'].forEach((s,k)=>{ctx.fillStyle='#a8bdcf';ctx.fillText(s,8,14+k*(box.height-26)/3)});
 const r=Math.max(2.2,Math.min(4,box.width/95));
 graph.neurons.forEach(n=>{const [x,y]=point(n);const on=lit.has(n.id);ctx.globalAlpha=on?1:.3;ctx.fillStyle=on?'#ffffff':colors[n.group];ctx.beginPath();if(n.inhibitory){ctx.moveTo(x,y-r-1);ctx.lineTo(x+r+1,y);ctx.lineTo(x,y+r+1);ctx.lineTo(x-r-1,y);ctx.closePath()}else ctx.arc(x,y,r,0,Math.PI*2);ctx.fill()});ctx.globalAlpha=1;
}
new ResizeObserver(draw).observe(canvas);
const arena=$('arena'), ac=arena.getContext('2d');
function drawArena(){
 const b=arena.getBoundingClientRect(), dpr=Math.min(devicePixelRatio||1,2);
 arena.width=Math.round(b.width*dpr);arena.height=Math.round(b.width*dpr);ac.scale(dpr,dpr);
 if(!world)return;const s=b.width/100,w=world;
 ac.strokeStyle='#1b2d3e';ac.lineWidth=1;
 for(let i=10;i<100;i+=10){ac.beginPath();ac.moveTo(i*s,0);ac.lineTo(i*s,b.width);ac.moveTo(0,i*s);ac.lineTo(b.width,i*s);ac.stroke()}
 const sx=w.source.x*s,sy=w.source.y*s;
 const haze=ac.createRadialGradient(sx,sy,0,sx,sy,w.source.odor_sigma*2*s);haze.addColorStop(0,'#60dda04a');haze.addColorStop(1,'#60dda000');ac.fillStyle=haze;ac.fillRect(0,0,b.width,b.width);
 ac.beginPath();ac.arc(sx,sy,w.source.radius*s,0,2*Math.PI);ac.fillStyle='#63dfaa33';ac.fill();ac.strokeStyle='#63dfaa';ac.stroke();ac.beginPath();ac.arc(sx,sy,3,0,2*Math.PI);ac.fillStyle='#97ffbd';ac.fill();ac.font='11px system-ui';ac.fillText('VOEDSEL',Math.min(sx+9,b.width-62),sy-9);
 ac.beginPath();w.trail.forEach(([x,y],i)=>{if(i===0)ac.moveTo(x*s,y*s);else ac.lineTo(x*s,y*s)});ac.strokeStyle='#a89dff99';ac.lineWidth=1.5;ac.stroke();
 ac.save();ac.translate(w.x*s,w.y*s);ac.rotate(w.heading_rad);
 ac.fillStyle='#c9e9ff99';for(const dy of [-3,3]){ac.beginPath();ac.ellipse(-2,dy,6,2.5,dy*.1,0,2*Math.PI);ac.fill()}
 ac.fillStyle='#ffffff';ac.beginPath();ac.ellipse(0,0,5,2.5,0,0,2*Math.PI);ac.fill();ac.fillStyle='#ffcc73';ac.beginPath();ac.arc(4,0,2,0,2*Math.PI);ac.fill();ac.strokeStyle='#ffcc73';ac.beginPath();ac.moveTo(5,0);ac.lineTo(9,-4);ac.moveTo(5,0);ac.lineTo(9,4);ac.stroke();ac.restore();
}
new ResizeObserver(drawArena).observe(arena);
function values(){return {stimulation:Number($('stimulation').value),ethanol_concentration:Number($('ethanol').value)}}
function labels(){$('stimValue').textContent=Number($('stimulation').value).toFixed(2);$('ethanolValue').textContent=Number($('ethanol').value).toFixed(2)}
async function post(path,data){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-FlyLab-Control':'1'},body:JSON.stringify(data)});if(!r.ok)throw Error(`Request failed (${r.status}). ${r.status===401?'Reload to sign in.':'Try again.'}`);return r.json()}
async function flush(){if(busy||!dirty)return;busy=true;dirty=false;try{await post('/api/controls',values());$('error').textContent=''}catch(e){$('error').textContent=e.message}finally{busy=false;if(dirty)flush()}}
for(const id of ['stimulation','ethanol'])$(id).addEventListener('input',()=>{dirty=true;labels();clearTimeout(timer);timer=setTimeout(flush,120)});
$('reset').onclick=async()=>{if(!confirm('Restart the shared trial for every viewer?'))return;$('reset').disabled=true;try{await post('/api/reset',{});$('error').textContent=''}catch(e){$('error').textContent=e.message}finally{$('reset').disabled=false}};
async function init(){try{const r=await fetch('/api/connectome');if(!r.ok)throw Error('Unable to load connectome. Reload to sign in.');graph=await r.json();draw();const stream=new EventSource('/api/events');stream.addEventListener('metrics',e=>{
 const m=JSON.parse(e.data);world=m.environment;drawArena();
 $('position').textContent=`${world.x.toFixed(1)}, ${world.y.toFixed(1)}`;$('distance').textContent=world.distance_to_source.toFixed(1);$('odor').textContent=`${world.antenna_left.toFixed(2)} / ${world.antenna_right.toFixed(2)}`;$('speed').textContent=world.speed_units_s.toFixed(2);$('reward').textContent=world.reward.toFixed(3);$('dwell').textContent=world.time_at_source_s.toFixed(1);
 lastMetric=Date.now();$('status').textContent='● Live';$('spikes').textContent=m.spikes;$('active').textContent=m.active_neuron_count;$('central').textContent=m.firing_rates_hz.central_complex.toFixed(1);$('motor').textContent=m.firing_rates_hz.motor_descending.toFixed(1);$('clock').textContent=m.trial_timestamp_s.toFixed(1);$('total').textContent=m.total_spikes;$('delay').textContent=m.transmission_delay_ms;lit=new Set(m.active_ids);draw();
 if(!dirty&&!busy&&!['stimulation','ethanol'].includes(document.activeElement.id)){$('stimulation').value=m.stimulation;$('ethanol').value=m.ethanol_concentration;labels()}
 });stream.addEventListener('fault',()=>{$('error').textContent='Simulation stopped. Check server logs.';stream.close()});stream.onerror=()=>{$('status').textContent='Reconnecting…'};window.addEventListener('pagehide',()=>stream.close());window.addEventListener('pageshow',e=>{if(e.persisted)location.reload()});
 }catch(e){$('error').textContent=e.message;$('status').textContent='Disconnected'}}
setInterval(()=>{if(Date.now()-lastMetric>1500){lit.clear();draw();$('status').textContent='Waiting for data…'}},1000);init();
</script></main></body></html>'''


def create_app(password: str, public_origin: str | None = None) -> Flask:
    """Factory does not start threads; main() explicitly owns engine lifetime."""
    if not isinstance(password, str) or len(password) < 20:
        raise ValueError('Use a password of at least 20 characters.')
    if public_origin:
        u = urlsplit(public_origin)
        if u.scheme != 'https' or not u.hostname or u.username or u.password or u.path not in ('', '/') or u.query or u.fragment:
            raise ValueError('FLY_PUBLIC_ORIGIN must be an HTTPS origin, e.g. https://fly.example.org')
        public_origin = f'https://{u.netloc}'
    app = Flask(__name__)
    app.config.update(MAX_CONTENT_LENGTH=2048,
                      TRUSTED_HOSTS=[urlsplit(public_origin).hostname] if public_origin else ['localhost', '127.0.0.1', '[::1]'])
    expected_digest = hashlib.sha256(password.encode()).digest()
    simulation = Simulation(Connectome.mock())
    app.extensions['simulation'] = simulation
    # Global bounded authentication throttle; no unbounded per-IP maps. During
    # attacks this can limit valid logins too. Add proxy rate limits for public use.
    auth_lock = threading.Lock()
    auth_times = []

    @app.before_request
    def protect():
        g.nonce = secrets.token_urlsafe(24)
        auth = request.authorization
        valid = (auth is not None and auth.type == 'basic' and auth.username == 'fly'
                 and auth.password is not None and hmac.compare_digest(
                     hashlib.sha256(auth.password.encode()).digest(), expected_digest))
        if not valid:
            with auth_lock:
                now = time.monotonic()
                auth_times[:] = [t for t in auth_times if now - t < 60]
                if len(auth_times) >= 30:
                    return Response('Too many authentication failures. Retry in a minute.', 429,
                                    headers={'Retry-After': '60'})
                auth_times.append(now)
            return Response('Authentication required.', 401,
                            headers={'WWW-Authenticate': 'Basic realm="Fly Circuit Lab", charset="UTF-8"'})
        if request.method == 'POST':
            origin = public_origin or request.host_url.rstrip('/')
            if request.headers.get('Origin') != origin or request.headers.get('X-FlyLab-Control') != '1':
                abort(403, 'Same-origin control requests required.')
            if not request.is_json:
                abort(415, 'JSON required.')

    @app.after_request
    def headers(response):
        nonce = getattr(g, 'nonce', '')
        response.headers['Content-Security-Policy'] = (
            f"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; "
            "connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Cache-Control'] = 'no-store'
        if public_origin:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        return response

    @app.get('/')
    def index():
        return render_template_string(PAGE, nonce=g.nonce)

    @app.get('/api/connectome')
    def connectome():
        return jsonify(simulation.model.connectome.graph())

    @app.get('/api/metrics')
    def metrics():
        with simulation.lock:
            if simulation.failure:
                return jsonify(error=simulation.failure), 503
            if simulation.latest is None:
                return jsonify(error='Simulation is starting'), 503
            return jsonify(simulation.latest)

    @app.post('/api/controls')
    def controls():
        data = request.get_json()
        if not isinstance(data, dict) or not data or set(data) - {'stimulation', 'ethanol_concentration'}:
            abort(400, 'Provide stimulation and/or ethanol_concentration only.')
        for value in data.values():
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1 or not math.isfinite(value):
                abort(400, 'Each control must be a finite number from 0 to 1.')
        with simulation.lock:
            for key, value in data.items():
                setattr(simulation.model, key, float(value))
            return jsonify(stimulation=simulation.model.stimulation,
                           ethanol_concentration=simulation.model.ethanol_concentration)

    @app.post('/api/reset')
    def reset():
        if request.get_json() != {}:
            abort(400, 'Reset expects an empty JSON object.')
        with simulation.lock:
            simulation.model.reset()
            simulation.latest = None
            return jsonify(trial_id=simulation.model.trial_id)

    @app.get('/api/events')
    def events():
        if not simulation.stream_slots.acquire(blocking=False):
            return Response('Maximum of eight concurrent streams reached.', 503, headers={'Retry-After': '5'})
        released = False
        def release():
            nonlocal released
            if not released:
                released = True
                simulation.stream_slots.release()
        def generate():
            last = -1
            expiry = time.monotonic() + 30
            try:
                yield 'retry: 1000\n\n'
                while not simulation.stop_event.is_set() and time.monotonic() < expiry:
                    with simulation.lock:
                        simulation.lock.wait_for(lambda: simulation.sequence != last or simulation.failure or simulation.stop_event.is_set(), timeout=5)
                        if simulation.failure:
                            yield 'event: fault\ndata: {"error":"Simulation stopped"}\n\n'
                            return
                        snapshot = simulation.latest
                        sequence = simulation.sequence
                    if snapshot is not None and sequence != last:
                        last = sequence
                        yield f'id: {sequence}\nevent: metrics\ndata: {json.dumps(snapshot, allow_nan=False)}\n\n'
                    else:
                        if snapshot is None:
                            last = sequence
                        yield ': heartbeat\n\n'
            finally:
                release()
        response = Response(generate(), mimetype='text/event-stream',
                            headers={'X-Accel-Buffering': 'no'})
        response.call_on_close(release)
        return response

    return app


def main():
    from waitress import serve
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    password = os.environ.get('FLY_PASSWORD') or getpass.getpass('Set access password (20+ characters; username fly): ')
    app = create_app(password, os.environ.get('FLY_PUBLIC_ORIGIN'))
    port = int(os.environ.get('FLY_PORT', '8000'))
    if not 1024 <= port <= 65535:
        raise ValueError('FLY_PORT must be between 1024 and 65535.')
    engine = app.extensions['simulation']
    atexit.register(engine.close)
    engine.start()
    LOG.info('Fly Circuit Lab listening on http://127.0.0.1:%d ; user: fly', port)
    try:
        # Loopback only: access remotely through TLS reverse proxy or SSH tunnel.
        # One process, 16 request threads, at most 8 SSE clients leaves API capacity.
        serve(app, host='127.0.0.1', port=port, threads=16,
              max_request_body_size=2048, channel_timeout=45, connection_limit=64)
    finally:
        engine.close()


if __name__ == '__main__':
    main()
