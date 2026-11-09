import type { ItemId } from '../types';
import { ITEMS, RECIPES, SHOP_GOODS } from '../data/items';
import type { DialogLine } from '../data/dialogs';
import { drawItemIcon } from '../core/utils';
import { SKILL_INFO } from '../game/player';

export interface UIHooks {
  onStart: () => void;
  onRespawn: () => void;
  onRestart: () => void;
  onTitle: () => void;
  onUseItem: (id: ItemId) => void;
  onBuy: (id: ItemId) => void;
  onCraft: (index: number) => void;
  onClosePanel: () => void;
  onResume: () => void;
  onDialogueEnd?: () => void;
}

export interface Snapshot {
  money: number;
  counts: Partial<Record<ItemId, number>>;
}

type PanelKind = 'inventory' | 'shop' | 'help' | 'pause' | null;

export class UI {
  root: HTMLElement;
  hooks: UIHooks;
  private titleEl!: HTMLElement;
  private hudEl!: HTMLElement;
  private panelEl!: HTMLElement;
  private dialogueEl!: HTMLElement;
  private deathEl!: HTMLElement;
  private victoryEl!: HTMLElement;
  private fadeEl!: HTMLElement;
  private promptEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private bossEl!: HTMLElement;
  private buffEl!: HTMLElement;

  private titleVisible = true;
  private panelOpen = false;
  private panelKind: PanelKind = null;
  private dialogueOpen = false;
  private deadOpen = false;
  private victoryOpen = false;

  private dialogLines: DialogLine[] = [];
  private dialogIndex = 0;
  private dialogChars = 0;
  private dialogDone = false;
  private dialogTimer: number | null = null;
  private dialogOnDone: (() => void) | null = null;
  private dialogSpeakerEl!: HTMLElement;
  private dialogTextEl!: HTMLElement;
  private dialogPortraitEl!: HTMLElement;

  private snapshot: Snapshot = { money: 0, counts: {} };
  private iconCache = new Map<string, string>();
  private bannerTimer: number | null = null;

  constructor(root: HTMLElement, hooks: UIHooks) {
    this.root = root;
    this.hooks = hooks;
    this.build();
    this.bind();
  }

  private build() {
    this.root.innerHTML = `
      <div class="hud" id="hud">
        <div class="hud-tl">
          <div class="region-name" id="region-name">青石镇</div>
          <div class="objective"><span class="obj-mark"></span><span id="obj-text">……</span></div>
        </div>
        <div class="hud-tr">
          <div class="money"><span class="coin"></span><b id="money-val">0</b><span class="unit">文</span></div>
          <div class="hud-hint">Tab 行囊 · H 帮助 · M 静音</div>
        </div>

        <div class="boss-bar hidden" id="boss-bar">
          <div class="boss-top"><span class="boss-name">无面</span><span class="boss-phase" id="boss-phase">一相</span></div>
          <div class="boss-track"><div class="boss-fill" id="boss-fill"></div></div>
        </div>

        <div class="hud-bl">
          <div class="bars">
            <div class="bar hp"><div class="fill" id="hp-fill"></div><span class="bar-label">气血</span><span class="bar-num" id="hp-num">120/120</span></div>
            <div class="bar chi"><div class="fill" id="chi-fill"></div><span class="bar-label">内力</span><span class="bar-num" id="chi-num">100/100</span></div>
            <div class="bar st"><div class="fill" id="st-fill"></div><span class="bar-label">气力</span><span class="bar-num" id="st-num">100/100</span></div>
          </div>
          <div class="skills" id="skills"></div>
        </div>

        <div class="hud-br">
          <div class="quick" data-item="pill_heal">
            <span class="quick-key">Q</span><span class="quick-icon" data-icon="pill_heal"></span>
            <div class="quick-meta"><span class="quick-name">回春丹</span><span class="quick-count" id="quick-heal">0</span></div>
          </div>
          <div class="quick" data-item="pill_chi">
            <span class="quick-key">R</span><span class="quick-icon" data-icon="pill_chi"></span>
            <div class="quick-meta"><span class="quick-name">凝神散</span><span class="quick-count" id="quick-chi">0</span></div>
          </div>
        </div>

        <div class="buff-row" id="buff-row"></div>
        <div class="interact-prompt hidden" id="prompt"><span class="key">E</span><span id="prompt-text">交谈</span></div>
        <div class="toast-area" id="toast-area"></div>
        <div class="banner hidden" id="banner"><div class="banner-line"></div><div class="banner-title" id="banner-title"></div><div class="banner-sub" id="banner-sub"></div><div class="banner-line"></div></div>
      </div>

      <div class="dialogue hidden" id="dialogue">
        <div class="dlg-portrait" id="dlg-portrait"></div>
        <div class="dlg-body">
          <div class="dlg-speaker" id="dlg-speaker"></div>
          <div class="dlg-text" id="dlg-text"></div>
          <div class="dlg-hint"><span class="key">空格</span> 继续</div>
        </div>
      </div>

      <div class="panel-wrap hidden" id="panel-wrap">
        <div class="panel" id="panel"></div>
      </div>

      <div class="title-screen" id="title-screen">
        <div class="title-bg"></div>
        <div class="title-shade"></div>
        <div class="title-content">
          <div class="title-kicker">2D 像素 · 俯视角武侠 · 动作冒险</div>
          <h1 class="game-title">烬影<span>·</span>墨刃</h1>
          <p class="title-sub">师父死了，凶手没有脸。<br />你带着他的刀，走进这场红雨。</p>
          <div class="title-buttons">
            <button class="btn primary" data-action="start">踏 入 江 湖</button>
            <button class="btn" data-action="title-help">操 作 说 明</button>
          </div>
          <div class="title-controls hidden" id="title-controls">
            <div><b>WASD</b> 移动</div>
            <div><b>鼠标左键 / J</b> 挥刀</div>
            <div><b>1 2 3</b> 三段武学</div>
            <div><b>空格 / Shift</b> 翻滚闪避（有完美闪避判定）</div>
            <div><b>Q / R</b> 快速服丹</div>
            <div><b>E</b> 交谈 / 采集 / 开门</div>
            <div><b>Tab</b> 行囊 · <b>H</b> 帮助 · <b>Esc</b> 暂停</div>
          </div>
          <div class="title-foot">气质参考：黑神话：悟空 · 影之刃零　|　建议戴上耳机</div>
        </div>
      </div>

      <div class="end-screen hidden" id="death-screen">
        <div class="end-inner">
          <div class="end-kicker">刀 折 · 人 亡</div>
          <h2 class="end-title">红雨又落了一场</h2>
          <p class="end-sub">你在青石镇的灯下醒来。伤还在，路也还在。</p>
          <div class="end-buttons">
            <button class="btn primary" data-action="respawn">在青石镇醒来</button>
            <button class="btn" data-action="title">回到标题</button>
          </div>
        </div>
      </div>

      <div class="end-screen victory-screen hidden" id="victory-screen">
        <div class="end-inner">
          <div class="end-kicker">第 一 章 · 烬</div>
          <h2 class="end-title">红雨停了</h2>
          <div class="ending-lines" id="ending-lines"></div>
          <div class="end-stats" id="end-stats"></div>
          <div class="end-buttons">
            <button class="btn primary" data-action="restart">再 战 一 场</button>
            <button class="btn" data-action="title">回到标题</button>
          </div>
        </div>
      </div>

      <div class="fade" id="fade"></div>
    `;

    const $ = <T extends HTMLElement = HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.titleEl = $('#title-screen');
    this.hudEl = $('#hud');
    this.panelEl = $('#panel');
    this.dialogueEl = $('#dialogue');
    this.deathEl = $('#death-screen');
    this.victoryEl = $('#victory-screen');
    this.fadeEl = $('#fade');
    this.promptEl = $('#prompt');
    this.toastEl = $('#toast-area');
    this.bannerEl = $('#banner');
    this.bossEl = $('#boss-bar');
    this.buffEl = $('#buff-row');
    this.dialogSpeakerEl = $('#dlg-speaker');
    this.dialogTextEl = $('#dlg-text');
    this.dialogPortraitEl = $('#dlg-portrait');

    this.buildSkills();
    this.hudEl.classList.add('hidden');
  }

  private buildSkills() {
    const skills = this.root.querySelector('#skills')!;
    skills.innerHTML =
      SKILL_INFO.map(
        (s, i) => `
        <div class="skill" data-skill="${i}">
          <span class="skill-key">${s.key}</span>
          <span class="skill-glyph">${['裂', '回', '烬'][i]}</span>
          <span class="skill-name">${s.name.split('·')[1] ?? s.name}</span>
          <div class="cd-mask" id="cd-${i}"></div>
          <div class="cd-num" id="cdnum-${i}"></div>
        </div>`,
      ).join('') +
      `<div class="skill dodge">
         <span class="skill-key">空格</span>
         <span class="skill-glyph">闪</span>
         <span class="skill-name">翻滚</span>
         <div class="cd-mask" id="cd-dodge"></div>
       </div>`;
  }

  private bind() {
    window.addEventListener('keydown', (e) => {
      if (!this.dialogueOpen) return;
      if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.advanceDialog();
      }
    });

    this.root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const el = target.closest('[data-action]') as HTMLElement | null;
      if (!el) return;
      const action = el.dataset.action;
      if (!action) return;
      if (action === 'start') {
        this.titleVisible = false;
        this.titleEl.classList.add('hidden');
        this.hudEl.classList.remove('hidden');
        this.hooks.onStart();
      } else if (action === 'title-help') {
        this.root.querySelector('#title-controls')?.classList.toggle('hidden');
      } else if (action === 'respawn') {
        this.deadOpen = false;
        this.deathEl.classList.add('hidden');
        this.hooks.onRespawn();
      } else if (action === 'restart') {
        this.victoryOpen = false;
        this.victoryEl.classList.add('hidden');
        this.hooks.onRestart();
      } else if (action === 'title') {
        this.deadOpen = false;
        this.victoryOpen = false;
        this.deathEl.classList.add('hidden');
        this.victoryEl.classList.add('hidden');
        this.hooks.onTitle();
      } else if (action === 'resume') {
        this.closePanel();
        this.hooks.onResume();
      } else if (action === 'close') {
        this.closePanel();
        this.hooks.onClosePanel();
      } else if (action === 'tab') {
        this.renderPanel(el.dataset.tab === 'craft' ? 'craft' : 'buy');
      } else if (action === 'use') {
        this.hooks.onUseItem(el.dataset.id as ItemId);
      } else if (action === 'buy') {
        this.hooks.onBuy(el.dataset.id as ItemId);
      } else if (action === 'craft') {
        this.hooks.onCraft(Number(el.dataset.index));
      }
    });
  }

  /* ----------------------------- 状态 ----------------------------- */
  isOpen() {
    return this.dialogueOpen || this.panelOpen || this.titleVisible || this.deadOpen || this.victoryOpen;
  }

  isDialogueOpen() {
    return this.dialogueOpen;
  }

  isPanelOpen() {
    return this.panelOpen;
  }

  showTitle() {
    this.titleVisible = true;
    this.titleEl.classList.remove('hidden');
    this.hudEl.classList.add('hidden');
    this.dialogueEl.classList.add('hidden');
    this.panelEl.parentElement?.classList.add('hidden');
    this.deathEl.classList.add('hidden');
    this.victoryEl.classList.add('hidden');
    this.bossEl.classList.add('hidden');
  }

  /* ----------------------------- HUD ----------------------------- */
  setRegion(name: string) {
    const el = this.root.querySelector('#region-name')!;
    el.textContent = name;
  }

  setObjective(text: string) {
    const el = this.root.querySelector('#obj-text')!;
    el.textContent = text;
  }

  setVitals(p: {
    hp: number;
    maxHp: number;
    chi: number;
    maxChi: number;
    stamina: number;
    maxStamina: number;
  }) {
    const hpPct = Math.max(0, p.hp / p.maxHp);
    (this.root.querySelector('#hp-fill') as HTMLElement).style.width = `${hpPct * 100}%`;
    (this.root.querySelector('#chi-fill') as HTMLElement).style.width = `${(p.chi / p.maxChi) * 100}%`;
    (this.root.querySelector('#st-fill') as HTMLElement).style.width = `${(p.stamina / p.maxStamina) * 100}%`;
    (this.root.querySelector('#hp-num') as HTMLElement).textContent = `${Math.ceil(p.hp)}/${p.maxHp}`;
    (this.root.querySelector('#chi-num') as HTMLElement).textContent = `${Math.floor(p.chi)}/${p.maxChi}`;
    (this.root.querySelector('#st-num') as HTMLElement).textContent = `${Math.floor(p.stamina)}/${p.maxStamina}`;
    this.root.querySelector('.bar.hp')?.classList.toggle('low', hpPct < 0.3);
  }

  setMoney(n: number) {
    const el = this.root.querySelector('#money-val');
    if (el) el.textContent = String(n);
  }

  updateSkills(cooldowns: number[], chi: number, dodgeCd: number) {
    for (let i = 0; i < 3; i++) {
      const mask = this.root.querySelector(`#cd-${i}`) as HTMLElement | null;
      const num = this.root.querySelector(`#cdnum-${i}`) as HTMLElement | null;
      const skill = this.root.querySelector(`[data-skill="${i}"]`) as HTMLElement | null;
      if (!mask || !num || !skill) continue;
      const ratio = Math.min(1, cooldowns[i] / SKILL_INFO[i].cd);
      mask.style.height = `${ratio * 100}%`;
      num.textContent = cooldowns[i] > 0.1 ? cooldowns[i].toFixed(1) : '';
      skill.classList.toggle('unaffordable', chi < SKILL_INFO[i].cost);
    }
    const dmask = this.root.querySelector('#cd-dodge') as HTMLElement | null;
    if (dmask) dmask.style.height = `${Math.min(1, dodgeCd / 0.45) * 100}%`;
  }

  updateQuick(heal: number, chi: number) {
    const h = this.root.querySelector('#quick-heal');
    const c = this.root.querySelector('#quick-chi');
    if (h) h.textContent = String(heal);
    if (c) c.textContent = String(chi);
    this.setQuickIcon('pill_heal');
    this.setQuickIcon('pill_chi');
  }

  private setQuickIcon(id: ItemId) {
    const el = this.root.querySelector(`[data-icon="${id}"]`) as HTMLElement | null;
    if (!el) return;
    if (!el.dataset.filled) {
      el.style.backgroundImage = `url(${this.icon(id)})`;
      el.dataset.filled = '1';
    }
  }

  setPrompt(text: string | null) {
    if (!text) {
      this.promptEl.classList.add('hidden');
    } else {
      this.promptEl.classList.remove('hidden');
      const t = this.root.querySelector('#prompt-text');
      if (t) t.textContent = text;
    }
  }

  setBuffs(buffs: { crit: number; speed: number; guard: number }) {
    const parts: string[] = [];
    if (buffs.crit > 0) parts.push(`<span class="buff crit">刀意·破 ${buffs.crit.toFixed(1)}s</span>`);
    if (buffs.speed > 0) parts.push(`<span class="buff speed">清风 ${buffs.speed.toFixed(1)}s</span>`);
    if (buffs.guard > 0) parts.push(`<span class="buff guard">金刚 ${buffs.guard.toFixed(1)}s</span>`);
    this.buffEl.innerHTML = parts.join('');
  }

  showBoss(name: string, hp: number, maxHp: number, phase: number) {
    this.bossEl.classList.remove('hidden');
    const n = this.bossEl.querySelector('.boss-name');
    if (n) n.textContent = name;
    (this.root.querySelector('#boss-fill') as HTMLElement).style.width = `${Math.max(0, (hp / maxHp) * 100)}%`;
    const ph = this.root.querySelector('#boss-phase');
    if (ph) ph.textContent = phase === 1 ? '一相' : phase === 2 ? '二相' : '三相';
  }

  hideBoss() {
    this.bossEl.classList.add('hidden');
  }

  toast(msg: string) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    this.toastEl.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 2400);
  }

  banner(title: string, sub = '') {
    const t = this.root.querySelector('#banner-title');
    const s = this.root.querySelector('#banner-sub');
    if (t) t.textContent = title;
    if (s) s.textContent = sub;
    this.bannerEl.classList.remove('hidden');
    this.bannerEl.classList.add('show');
    if (this.bannerTimer) window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.bannerEl.classList.remove('show');
      this.bannerEl.classList.add('hidden');
    }, 2400);
  }

  /* --------------------------- 对话 --------------------------- */
  showDialogue(lines: DialogLine[], onDone: () => void) {
    this.dialogLines = lines;
    this.dialogIndex = 0;
    this.dialogDone = false;
    this.dialogOnDone = onDone;
    this.dialogueOpen = true;
    this.dialogueEl.classList.remove('hidden');
    this.setPrompt(null);
    this.renderDialogLine();
  }

  private renderDialogLine() {
    const line = this.dialogLines[this.dialogIndex];
    if (!line) return;
    this.dialogSpeakerEl.textContent = line.speaker;
    this.dialogTextEl.textContent = '';
    this.dialogPortraitEl.className = 'dlg-portrait';
    this.dialogPortraitEl.style.backgroundImage = line.portrait
      ? `url(./assets/art/${line.portrait}.jpg)`
      : '';
    if (line.portrait) this.dialogPortraitEl.classList.add('has-art');
    this.dialogChars = 0;
    this.dialogDone = false;
    if (this.dialogTimer) window.clearInterval(this.dialogTimer);
    this.dialogTimer = window.setInterval(() => {
      this.dialogChars += 1;
      this.dialogTextEl.textContent = line.text.slice(0, this.dialogChars);
      if (this.dialogChars >= line.text.length) {
        if (this.dialogTimer) window.clearInterval(this.dialogTimer);
        this.dialogTimer = null;
        this.dialogDone = true;
      }
    }, 26);
  }

  private advanceDialog() {
    if (!this.dialogueOpen) return;
    if (!this.dialogDone) {
      const line = this.dialogLines[this.dialogIndex];
      this.dialogTextEl.textContent = line.text;
      this.dialogChars = line.text.length;
      this.dialogDone = true;
      if (this.dialogTimer) window.clearInterval(this.dialogTimer);
      this.dialogTimer = null;
      return;
    }
    this.dialogIndex += 1;
    if (this.dialogIndex >= this.dialogLines.length) {
      this.finishDialog();
      return;
    }
    this.renderDialogLine();
  }

  private finishDialog() {
    if (!this.dialogueOpen) return;
    this.dialogueOpen = false;
    this.dialogueEl.classList.add('hidden');
    if (this.dialogTimer) window.clearInterval(this.dialogTimer);
    this.dialogTimer = null;
    // 防止结束对话的那一次按键在同一帧里立刻触发翻滚/交互
    this.hooks.onDialogueEnd?.();
    const cb = this.dialogOnDone;
    this.dialogOnDone = null;
    if (cb) cb();
  }

  /* --------------------------- 面板 --------------------------- */
  openInventory(snap: Snapshot) {
    this.snapshot = snap;
    this.panelOpen = true;
    this.panelKind = 'inventory';
    this.panelEl.parentElement?.classList.remove('hidden');
    this.renderInventory();
  }

  openShop(snap: Snapshot, money: number) {
    this.snapshot = snap;
    void money;
    this.panelOpen = true;
    this.panelKind = 'shop';
    this.panelEl.parentElement?.classList.remove('hidden');
    this.panelEl.classList.add('shop-panel');
    this.renderPanel('buy');
  }

  refreshPanel(snap: Snapshot) {
    this.snapshot = snap;
    if (!this.panelOpen) return;
    if (this.panelKind === 'inventory') this.renderInventory();
  }

  refreshShop(snap: Snapshot) {
    this.snapshot = snap;
    if (!this.panelOpen || this.panelKind !== 'shop') return;
    const activeTab = this.panelEl.querySelector('.tab.active') as HTMLElement | null;
    this.renderPanel(activeTab?.dataset.tab === 'craft' ? 'craft' : 'buy');
  }

  openHelp() {
    this.panelOpen = true;
    this.panelKind = 'help';
    this.panelEl.parentElement?.classList.remove('hidden');
    this.panelEl.classList.remove('shop-panel');
    this.panelEl.innerHTML = `
      <div class="panel-head"><div class="panel-title">刀谱 · 操作</div><button class="close-btn" data-action="close">×</button></div>
      <div class="help-grid">
        <div><span class="key">W A S D</span> 八方移动</div>
        <div><span class="key">鼠标左键 / J</span> 三段普攻（朝鼠标方向）</div>
        <div><span class="key">1</span> 裂空·一闪：突进斩，突进期间无敌</div>
        <div><span class="key">2</span> 回风·刃轮：环身刀气，持续伤害</div>
        <div><span class="key">3</span> 烬灭·斩：蓄力后大范围爆发</div>
        <div><span class="key">空格 / Shift</span> 翻滚闪避，消耗气力</div>
        <div><span class="key">完美闪避</span> 在受击前 0.16 秒内翻滚：触发时缓、回内力气力、获得「刀意·破」增伤</div>
        <div><span class="key">Q / R</span> 快速服用回春丹 / 凝神散</div>
        <div><span class="key">E</span> 交谈、采集、开箱、过门</div>
        <div><span class="key">Tab</span> 行囊　<span class="key">H</span> 帮助　<span class="key">Esc</span> 暂停</div>
      </div>
      <div class="panel-hint">药材来自野外采集与敌人掉落；在药铺可购买与炼制。</div>
      <div class="panel-foot"><button class="btn small" data-action="close">关 闭</button></div>
    `;
  }

  openPause() {
    this.panelOpen = true;
    this.panelKind = 'pause';
    this.panelEl.parentElement?.classList.remove('hidden');
    this.panelEl.classList.remove('shop-panel');
    this.panelEl.innerHTML = `
      <div class="panel-head"><div class="panel-title">暂 停</div><button class="close-btn" data-action="resume">×</button></div>
      <div class="pause-body">
        <p>红雨未停，刀锋未冷。</p>
        <div class="pause-keys">
          <span><b>Tab</b> 行囊</span><span><b>H</b> 刀谱</span><span><b>M</b> 静音</span>
        </div>
      </div>
      <div class="panel-foot">
        <button class="btn primary small" data-action="resume">继 续</button>
        <button class="btn small" data-action="title">回到标题</button>
      </div>
    `;
  }

  closePanel() {
    this.panelOpen = false;
    this.panelKind = null;
    this.panelEl.parentElement?.classList.add('hidden');
    this.panelEl.classList.remove('shop-panel');
  }

  private icon(id: ItemId) {
    let url = this.iconCache.get(id);
    if (url) return url;
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 48;
    const ctx = c.getContext('2d')!;
    drawItemIcon(ctx, id, 48);
    url = c.toDataURL();
    this.iconCache.set(id, url);
    return url;
  }

  private renderInventory() {
    const counts = this.snapshot.counts;
    const entries = (Object.keys(ITEMS) as ItemId[]).filter((id) => (counts[id] ?? 0) > 0);
    const cards = entries
      .map((id) => {
        const def = ITEMS[id];
        const count = counts[id] ?? 0;
        const usable = def.type === 'pill';
        return `
        <div class="item-card ${def.type}">
          <div class="item-icon" style="background-image:url(${this.icon(id)})"></div>
          <div class="item-main">
            <div class="item-name">${def.name}<span class="item-count">×${count}</span></div>
            <div class="item-desc">${def.desc}</div>
          </div>
          ${usable ? `<button class="btn tiny" data-action="use" data-id="${id}">服用</button>` : `<div class="item-tag">${def.type === 'key' ? '信物' : '材料'}</div>`}
        </div>`;
      })
      .join('');
    this.panelEl.classList.remove('shop-panel');
    this.panelEl.innerHTML = `
      <div class="panel-head">
        <div class="panel-title">行 囊</div>
        <button class="close-btn" data-action="close">×</button>
      </div>
      <div class="panel-meta">铜钱 <b>${this.snapshot.money}</b> 文 · 战斗中可按 Q / R 快速服丹</div>
      <div class="item-grid">
        ${cards || '<div class="empty">行囊空空，去野外采些药材吧。</div>'}
      </div>
      <div class="panel-foot"><span class="panel-hint">Tab / Esc 关闭</span></div>
    `;
  }

  private renderPanel(tab: 'buy' | 'craft') {
    const counts = this.snapshot.counts;
    const money = this.snapshot.money;
    const tabs = `
      <div class="tabs">
        <button class="tab ${tab === 'buy' ? 'active' : ''}" data-action="tab" data-tab="buy">购 买</button>
        <button class="tab ${tab === 'craft' ? 'active' : ''}" data-action="tab" data-tab="craft">炼 制</button>
      </div>`;
    let body = '';
    if (tab === 'buy') {
      body = SHOP_GOODS.map((g) => {
        const def = ITEMS[g.id];
        const afford = money >= g.price;
        return `
          <div class="shop-row">
            <div class="item-icon" style="background-image:url(${this.icon(g.id)})"></div>
            <div class="shop-main">
              <div class="shop-name">${def.name}<span class="own">持有 ${counts[g.id] ?? 0}</span></div>
              <div class="shop-desc">${def.desc}</div>
            </div>
            <button class="btn tiny ${afford ? '' : 'disabled'}" ${afford ? '' : 'disabled'} data-action="buy" data-id="${g.id}">
              <span class="price">${g.price}</span> 文
            </button>
          </div>`;
      }).join('');
    } else {
      body = RECIPES.map((r, idx) => {
        const def = ITEMS[r.out];
        const canAll = r.need.every(([id, n]) => (counts[id] ?? 0) >= n);
        const needs = r.need
          .map(([id, n]) => {
            const have = counts[id] ?? 0;
            return `<span class="need ${have >= n ? 'ok' : 'lack'}">${ITEMS[id].name} ${have}/${n}</span>`;
          })
          .join('<span class="sep">·</span>');
        return `
          <div class="shop-row">
            <div class="item-icon" style="background-image:url(${this.icon(r.out)})"></div>
            <div class="shop-main">
              <div class="shop-name">${def.name}<span class="own">持有 ${counts[r.out] ?? 0}</span></div>
              <div class="need-row">${needs}</div>
              <div class="shop-desc">${def.desc}</div>
            </div>
            <button class="btn tiny ${canAll ? '' : 'disabled'}" ${canAll ? '' : 'disabled'} data-action="craft" data-index="${idx}">炼 制</button>
          </div>`;
      }).join('');
    }
    this.panelEl.innerHTML = `
      <div class="panel-head">
        <div class="panel-title">葛九药铺</div>
        <div class="panel-money">铜钱 <b>${money}</b> 文</div>
        <button class="close-btn" data-action="close">×</button>
      </div>
      ${tabs}
      <div class="shop-list">${body}</div>
      <div class="panel-foot"><span class="panel-hint">Esc 离开药铺 · 药材来自野外采集与敌人掉落</span></div>
    `;
  }

  /* --------------------------- 结算 --------------------------- */
  showDeath() {
    this.deadOpen = true;
    this.deathEl.classList.remove('hidden');
  }

  showVictory(stats: { time: string; kills: number; money: number }, endingLines: string[]) {
    this.victoryOpen = true;
    this.hudEl.classList.add('hidden');
    this.bossEl.classList.add('hidden');
    const lines = this.root.querySelector('#ending-lines')!;
    lines.innerHTML = endingLines.map((l, i) => `<p style="animation-delay:${i * 0.5 + 0.2}s">${l}</p>`).join('');
    const st = this.root.querySelector('#end-stats')!;
    st.innerHTML = `<span>历时 ${stats.time}</span><span>斩敌 ${stats.kills}</span><span>余财 ${stats.money} 文</span>`;
    this.victoryEl.classList.remove('hidden');
  }

  hideDeath() {
    this.deadOpen = false;
    this.deathEl.classList.add('hidden');
  }

  showHUD() {
    this.hudEl.classList.remove('hidden');
  }

  fade(cb: () => void) {
    this.fadeEl.classList.add('on');
    window.setTimeout(() => {
      cb();
      window.setTimeout(() => this.fadeEl.classList.remove('on'), 80);
    }, 260);
  }

  hideVictory() {
    this.victoryOpen = false;
    this.victoryEl.classList.add('hidden');
  }
}
