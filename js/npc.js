/* ============================================================
 * npc.js —— 大厅 NPC「守灯人」与对话面板
 * ------------------------------------------------------------
 * 三态：idle（站桩）→ prompt（走近，气泡提示）→ talking（面板逐句推进）
 * 台词是静态脚本，零网络；面板是 DOM 覆盖层，不参与 canvas 主循环。
 * ============================================================ */
(function (global) {
  'use strict';

  var FONT_NAME = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';
  var FONT_SERIF = '"Songti SC", "STSong", "Source Han Serif SC", "SimSun", serif';

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  /* ============================================================
   * 对话面板：DOM 单例，NPC 只负责「说什么」，不关心怎么画
   * ============================================================ */
  var Panel = {
    root: null,
    nameEl: null,
    textEl: null,
    stepEl: null,
    ready: false,

    mount: function () {
      if (this.ready) return this.ok;
      this.root = document.getElementById('dialogue');
      this.nameEl = document.getElementById('dialogueName');
      this.textEl = document.getElementById('dialogueText');
      this.stepEl = document.getElementById('dialogueStep');
      this.ready = true;
      this.ok = !!(this.root && this.textEl);
      return this.ok;
    },

    show: function (name, text, index, total) {
      if (!this.mount()) return;
      if (this.nameEl) this.nameEl.textContent = name;
      this.textEl.textContent = text;
      if (this.stepEl) this.stepEl.textContent = index + ' / ' + total;
      this.root.classList.add('on');
    },

    hide: function () {
      if (!this.mount()) return;
      this.root.classList.remove('on');
    },

    isOpen: function () {
      return !!(this.root && this.root.classList.contains('on'));
    }
  };

  /* ============================================================
   * NPC
   * ============================================================ */
  /**
   * @param {number} x   脚底中心的 x
   * @param {number} y   脚底中心的 y
   * @param {object} opt { name, lines, line1, line2 }
   */
  function NPC(x, y, opt) {
    opt = opt || {};

    this.x = x;
    this.y = y;
    this.name = opt.name || '守灯人';

    /* 台词：以 lines 为主；兼容旧的 setLine(text) 单句用法 */
    this.lines = (opt.lines && opt.lines.length) ? opt.lines.slice() : [opt.line1 || '……又一位旅行者。'];
    this.lineIndex = 0;
    this.state = 'idle';          // idle | prompt | talking

    /* 气泡只留第一句问候，完整内容交给面板，避免重复 */
    this.line1 = opt.line1 || this.lines[0];
    this.line2 = opt.line2 || '按 E 与我说话';

    this.t = 0;
    this.w = 46;
    this.h = 92;
  }

  NPC.prototype.update = function (dt) {
    this.t += dt;
  };

  /* ---------- 对话控制 ---------- */
  NPC.prototype.openDialog = function () {
    this.state = 'talking';
    this.lineIndex = 0;
    this.sync();
  };

  /** 推进一步；返回 false 表示已经说完并关闭 */
  NPC.prototype.advance = function () {
    if (this.state !== 'talking') return false;
    if (this.lineIndex < this.lines.length - 1) {
      this.lineIndex++;
      this.sync();
      return true;
    }
    this.closeDialog();
    return false;
  };

  NPC.prototype.closeDialog = function () {
    this.state = 'idle';
    this.lineIndex = 0;
    Panel.hide();
  };

  NPC.prototype.sync = function () {
    Panel.show(this.name, this.lines[this.lineIndex], this.lineIndex + 1, this.lines.length);
  };

  NPC.prototype.reset = function () {
    this.state = 'idle';
    this.lineIndex = 0;
    Panel.hide();
  };

  /** 兼容占位版接口：外部改词时替换成单句 */
  NPC.prototype.setLine = function (text) {
    this.lines = [String(text)];
    this.lineIndex = 0;
    this.line1 = String(text);
    if (this.state === 'talking') this.sync();
  };

  /* ---------------- 绘制 ---------------- */
  NPC.prototype.render = function (ctx) {
    var x = this.x;
    var y = this.y;
    var breathe = Math.sin(this.t * 1.15);
    var float = breathe * 1.4;

    /* 影子 */
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = '#07050d';
    ctx.beginPath();
    ctx.ellipse(x, y - 2, 27, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* 走近时脚下亮一圈，和传送门的提示环同一个语言 */
    if (this.state === 'prompt' || this.state === 'talking') {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = 'rgba(240, 167, 110, 0.85)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(x, y + 1, 34 + Math.sin(this.t * 3.4) * 3, 9, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, y + float * 0.35);

    /* 长袍 */
    ctx.fillStyle = '#1e1830';
    ctx.beginPath();
    ctx.moveTo(-12, -70);
    ctx.lineTo(12, -70);
    ctx.quadraticCurveTo(18, -44, 22, -2);
    ctx.quadraticCurveTo(0, 6, -22, -2);
    ctx.quadraticCurveTo(-18, -44, -12, -70);
    ctx.closePath();
    ctx.fill();

    /* 袍子右侧暖边 */
    ctx.strokeStyle = 'rgba(240, 167, 110, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(11, -69);
    ctx.quadraticCurveTo(18, -44, 22, -2);
    ctx.stroke();

    /* 腰带 */
    ctx.strokeStyle = 'rgba(207, 91, 60, 0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-14, -40);
    ctx.lineTo(15, -40);
    ctx.stroke();

    /* 头 */
    ctx.fillStyle = '#f0cdaa';
    ctx.beginPath();
    ctx.arc(0, -82, 10.5, 0, Math.PI * 2);
    ctx.fill();

    /* 眼 */
    ctx.fillStyle = '#211a34';
    ctx.beginPath();
    ctx.arc(3.4, -83, 1.6, 0, Math.PI * 2);
    ctx.arc(-3.4, -83, 1.6, 0, Math.PI * 2);
    ctx.fill();

    /* 宽檐帽 */
    ctx.fillStyle = '#2b2342';
    ctx.beginPath();
    ctx.ellipse(0, -91, 22, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-11, -92);
    ctx.quadraticCurveTo(-9, -110, 0, -110);
    ctx.quadraticCurveTo(9, -110, 11, -92);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(240, 167, 110, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, -91.5, 22, 5, 0, Math.PI * 0.9, Math.PI * 2.1);
    ctx.stroke();

    /* 手提灯 */
    var lx = 23;
    var ly = -34 + breathe * 0.8;
    ctx.strokeStyle = '#2b2342';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, -46);
    ctx.lineTo(lx, ly - 9);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 206, 143, 0.16)';
    ctx.beginPath();
    ctx.arc(lx, ly, 26, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffd79a';
    ctx.beginPath();
    ctx.arc(lx, ly, 4.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 240, 210, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(lx, ly, 6.6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    /* 说话中就不画气泡了，面板已经占着同一个视觉位置 */
    if (this.state !== 'talking') this._bubble(ctx, x, y + float);
  };

  NPC.prototype._bubble = function (ctx, x, y) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '500 16px ' + FONT_NAME;
    var w1 = ctx.measureText(this.line1).width;
    ctx.font = '400 11px ' + FONT_NAME;
    var w2 = ctx.measureText(this.line2).width;

    var bw = Math.max(w1, w2, 96) + 40;
    var bh = 62;
    var bx = Math.round(x - bw / 2);
    var by = Math.round(y - 190);

    /* 气泡尾巴 */
    ctx.fillStyle = 'rgba(244, 232, 214, 0.96)';
    ctx.beginPath();
    ctx.moveTo(x - 7, by + bh - 2);
    ctx.lineTo(x + 7, by + bh - 2);
    ctx.lineTo(x, by + bh + 12);
    ctx.closePath();
    ctx.fill();

    /* 气泡本体 */
    ctx.shadowColor = 'rgba(6, 4, 12, 0.55)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    roundRect(ctx, bx, by, bw, bh, 14);
    ctx.fillStyle = 'rgba(244, 232, 214, 0.97)';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    /* 顶部细边 */
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1;
    roundRect(ctx, bx + 0.5, by + 0.5, bw - 1, bh - 1, 14);
    ctx.stroke();

    /* 正文 */
    ctx.fillStyle = '#241d38';
    ctx.font = '500 16px ' + FONT_NAME;
    ctx.fillText(this.line1, x, by + 25);

    /* 副行 */
    ctx.fillStyle = this.state === 'prompt' ? 'rgba(180, 82, 46, 0.9)' : 'rgba(60, 48, 78, 0.55)';
    ctx.font = '400 11px ' + FONT_NAME;
    ctx.fillText(this.line2, x, by + 45);

    /* 名字牌（气泡上方） */
    ctx.font = '600 11px ' + FONT_SERIF;
    var nw = ctx.measureText(this.name).width + 22;
    roundRect(ctx, x - nw / 2, by - 20, nw, 18, 9);
    ctx.fillStyle = 'rgba(20, 15, 34, 0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(240, 167, 110, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 217, 168, 0.92)';
    ctx.fillText(this.name, x, by - 10.5);

    ctx.restore();
  };

  global.NPC = NPC;
  global.DialoguePanel = Panel;
})(window);
