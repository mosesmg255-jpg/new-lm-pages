function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function padEnd(value, width) {
  const text = stripAnsi(value);
  if (text.length >= width) return text;
  return text + ' '.repeat(width - text.length);
}

function uniqueLines(lines) {
  const seen = new Set();
  return (Array.isArray(lines) ? lines : []).reduce((acc, item) => {
    const text = String(item ?? '');
    if (!seen.has(text)) {
      seen.add(text);
      acc.push(text);
    }
    return acc;
  }, []);
}

class TerminalSplitLayout {
  constructor() {
    this.bannerLines = [];
    this.activityLines = [];
    this.maxActivityLines = 24;
    this.visibleHeight = 16;
    this.rendered = false;
    this.renderTimer = null;
  }

  setBanner(lines) {
    this.bannerLines = uniqueLines(lines);
    this.renderNow();
  }

  pushStatus(line) {
    if (!process.stdout || !process.stdout.isTTY) return;
    const normalized = String(line);
    if (this.bannerLines.includes(normalized)) return;
    this.bannerLines.push(normalized);
    this.requestRender();
  }

  pushActivity(line) {
    if (!process.stdout || !process.stdout.isTTY) return;
    const normalized = String(line);
    if (!this.activityLines.includes(normalized)) {
      this.activityLines.push(normalized);
      if (this.activityLines.length > this.maxActivityLines) this.activityLines.shift();
      this.requestRender();
    }
  }

  requestRender() {
    if (!process.stdout || !process.stdout.isTTY) return;
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.renderNow();
    }, 30);
  }

  render() {
    this.requestRender();
  }

  renderNow() {
    if (!process.stdout || !process.stdout.isTTY) return;

    const width = process.stdout.columns || 140;
    const height = Math.min(process.stdout.rows || 40, this.visibleHeight);
    const leftWidth = Math.max(48, Math.min(70, Math.floor(width * 0.44)));
    const rightWidth = Math.max(40, width - leftWidth - 3);
    const leftLines = this.bannerLines.slice(0, height);
    const rightLines = this.activityLines.slice(-Math.max(1, height));

    process.stdout.write('\x1b[?25l\x1b[2J\x1b[H');
    process.stdout.write(`\x1b[36m${''.repeat(width)}\x1b[0m\n`);

    for (let i = 0; i < height; i++) {
      const left = leftLines[i] || '';
      const right = rightLines[i] || '';
      const leftText = padEnd(left, leftWidth);
      const rightText = padEnd(right, rightWidth);
      process.stdout.write(`${leftText}  ${rightText}\n`);
    }

    process.stdout.write(`\x1b[36m${''.repeat(width)}\x1b[0m\n`);
    process.stdout.write('\x1b[?25h');
  }
}

module.exports = new TerminalSplitLayout();
